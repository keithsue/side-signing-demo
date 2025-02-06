const { Buffer } = require('buffer');
const axios = require('axios');

const { MsgSend } = require("cosmjs-types/cosmos/bank/v1beta1/tx")
const { Tx, TxRaw, TxBody, Fee, AuthInfo, SignDoc } = require("cosmjs-types/cosmos/tx/v1beta1/tx")
const { SignMode } = require("cosmjs-types/cosmos/tx/signing/v1beta1/signing")
const { PubKey } = require("cosmjs-types/cosmos/crypto/secp256k1/keys")

const bitcoin = require("bitcoinjs-lib");
const bitcoinMessage = require("bitcoinjs-message");
const { ECPairFactory } = require("ecpair");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require('bip32')
const bip39 = require("bip39");

// init ECC
bitcoin.initEccLib(ecc);

// build global ECPair instance
const ECPair = ECPairFactory(ecc);

// build bip32 instance
const bip32 = BIP32Factory(ecc)

async function main() {
    // create client
    const restEndpoint = "https://rest.side.one"; // can be replaced by your choice
    const client = new Client(restEndpoint);

    // import private key from mnemonic
    const mnemonic = "<mnemonic>";
    const path = "m/86'/0'/0'/0/0"; // taproot path
    const privKey = derivePrivateKey(mnemonic, path);

    // // import private key
    // const privKeyHex = "<private key>"; // hex encoded private key
    // const privKey = Buffer.from(privKeyHex, "hex");

    const keyPair = ECPair.fromPrivateKey(privKey, { compressed: true });

    // generate taproot address
    const xOnlyPubKey = keyPair.publicKey.slice(1, 33);
    const p2tr = bitcoin.payments.p2tr({
        internalPubkey: Buffer.from(xOnlyPubKey),
        network: bitcoin.networks.bitcoin
    });
    const address = p2tr.address;

    // public key
    const pubkeyTypeUrl = "/cosmos.crypto.taproot.PubKey"; // for segwit: /cosmos.crypto.segwit.PubKey
    const publicKey = PubKey.fromPartial({
        key: keyPair.publicKey
    });

    // tx params
    const fromAddress = address;
    const toAddress = address
    const denom = "uside"
    const amount = "1000000"; // type: bigint
    const feeAmount = "300"; // type: bigint
    const gasLimit = "200000" // type: bigint
    const chainId = "sidechain-1"

    // account info
    const account = await client.getAccountInfo(fromAddress);
    const accountNumber = account.account_number;
    const accountSequence = account.sequence;

    // build send msg
    const msgSend = MsgSend.fromPartial({
        fromAddress: fromAddress,
        toAddress: toAddress,
        amount: [{
            denom: denom,
            amount: amount,
        }],
    });

    // fee
    const fee = Fee.fromPartial({
        amount: [
            {
                denom: denom,
                amount: feeAmount,
            },
        ],
        gasLimit: gasLimit,
    });

    // tx body
    const txBody = TxBody.fromPartial({
        messages: [
            {
                typeUrl: MsgSend.typeUrl,
                value: MsgSend.encode(msgSend).finish(),
            }
        ]
    });

    // auth info
    const authInfo = AuthInfo.fromPartial({
        signerInfos: [{
            publicKey: {
                typeUrl: pubkeyTypeUrl,
                value: PubKey.encode(publicKey).finish()
            },
            modeInfo: {
                single: {
                    mode: SignMode.SIGN_MODE_DIRECT
                }
            },
            sequence: accountSequence
        }],
        fee: fee
    });

    // build sign doc
    const signDoc = {
        bodyBytes: TxBody.encode(txBody).finish(),
        authInfoBytes: AuthInfo.encode(authInfo).finish(),
        chainId: chainId,
        accountNumber: accountNumber
    };

    // generate signing bytes
    const signingBytes = SignDoc.encode(signDoc).finish();

    // sign tx
    // Signing SPEC: BIP137 message signing
    const signature = bitcoinMessage.sign(signingBytes, privKey, true);

    // create signed raw tx
    const txRaw = TxRaw.fromPartial({
        bodyBytes: TxBody.encode(txBody).finish(),
        authInfoBytes: AuthInfo.encode(authInfo).finish(),
        signatures: [signature]
    });

    // broadcast tx
    const txRawBytes = TxRaw.encode(txRaw).finish();
    const txHash = await client.broadcastTx(Buffer.from(txRawBytes).toString("base64"));
    console.log(txHash);
}

// REST Client
class Client {
    constructor(baseURL) {
        this.client = axios.create({ baseURL });
    }

    async getAccountInfo(address) {
        try {
            const response = await this.client.get(`/cosmos/auth/v1beta1/accounts/${address}`);
            return response.data.account;
        } catch (error) {
            console.error('Error fetching account info:', error);
        }
    }

    async broadcastTx(tx) {
        try {
            const response = await this.client.post('/cosmos/tx/v1beta1/txs', { tx_bytes: tx, mode: "BROADCAST_MODE_SYNC" });
            return response.data.tx_response.txhash;
        } catch (error) {
            console.error('Error broadcasting transaction:', error);
        }
    }
}

// derive the private key from the specified mnemonic and path
function derivePrivateKey(mnemonic, path) {
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const child = root.derivePath(path);

    return child.privateKey;
}

main();
