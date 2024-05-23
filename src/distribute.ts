/// Distributing APT rewards to multiple target addresses in a single call by admin
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';
import {
    Account,
    AccountAddress,
    Aptos,
    AptosConfig,
    Ed25519PrivateKey,
    HexInput,
    InputGenerateTransactionPayloadData,
    Network,
    TransactionWorkerEventsEnum,
} from '@aptos-labs/ts-sdk';

dotenv.config();

// configure network
const APTOS_NETWORK: Network = Network.TESTNET;
// const APTOS_NETWORK: Network = Network.MAINNET;

const config = new AptosConfig({ network: APTOS_NETWORK });
const aptos = new Aptos(config);

// amount of APT in octas to distribute
const APT_AMOUNT = 40_000_000; // in octas (1 APT = 100_000_000 octas)

function isHexInput(value: string | undefined): value is string {
    return typeof value === 'string';
}

async function loadAddressesFromCSV(
    filePath: string,
): Promise<AccountAddress[]> {
    return new Promise((resolve, reject) => {
        const addresses: AccountAddress[] = [];
        const fileStream = fs.createReadStream(filePath);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        rl.on('line', line => {
            const trimmedLine = line.trim();
            if (trimmedLine) {
                addresses.push(AccountAddress.fromString(trimmedLine));
            }
        });
        rl.on('close', () => {
            resolve(addresses);
        });
        rl.on('error', error => {
            reject(error);
        });
    });
}

// TODO: Error handling for 1) out of gas 2) out of fund 3) network error
async function main() {
    if (!isHexInput(process.env.ADMIN_PRIVATE_KEY)) {
        throw new Error(
            'ADMIN_PRIVATE_KEY is not defined or not a valid HexInput',
        );
    }

    const admin_pk: HexInput = process.env.ADMIN_PRIVATE_KEY;
    const sender: Account = Account.fromPrivateKey({
        privateKey: new Ed25519PrivateKey(admin_pk),
    });
    const sender_balance = await aptos.getAccountAPTAmount({
        accountAddress: sender.accountAddress,
    });
    console.log(
        `sender (${sender.accountAddress}) APT balance: ${sender_balance} octas`,
    );

    // APT reward recipients addresses
    // const recipient_addresses: AccountAddress[] = [
    //     AccountAddress.fromString(
    //         '0x1f8c8ca3cdce70a9bf9cadcb8976ff28b26935a456d5e2004730809e85070f62',
    //     ),
    //     AccountAddress.fromString(
    //         '0xc515ea4268a4c22789b7c8fab2051d9cd828487795206a96c00f10dac8fe7d19',
    //     ),
    //     AccountAddress.fromString(
    //         '0xff9ec3d2bce27109103aaa613037c2130a0cb76be923d6e31fa91b55781e9721',
    //     ),
    //     AccountAddress.fromString(
    //         '0x794d6c3bdb7949dde2860ac1896a0682c22aff937572151e7f18c3b7a17c6763',
    //     ),
    //     AccountAddress.fromString(
    //         '0x035d6305afe22a01b6a38308eb69761a58fec0a386bbdd00c3a57a3b6ac5c998',
    //     ),
    // ];

    // Load recipient addresses from CSV file
    const csvFilePath = path.resolve(__dirname, '../addresses.csv');
    const recipient_addresses: AccountAddress[] =
        await loadAddressesFromCSV(csvFilePath);

    // create transaction payloads
    const payloads: InputGenerateTransactionPayloadData[] = [];

    for (let i = 0; i < recipient_addresses.length; i += 1) {
        const txn: InputGenerateTransactionPayloadData = {
            function: '0x1::aptos_account::transfer',
            functionArguments: [recipient_addresses[i], APT_AMOUNT],
        };
        payloads.push(txn);
    }

    // batch transfer
    console.log(
        `transferring ${APT_AMOUNT} octas to ${recipient_addresses.length} addresses...`,
    );
    aptos.transaction.batch.forSingleAccount({ sender, data: payloads });
    aptos.transaction.batch.on(
        TransactionWorkerEventsEnum.TransactionExecuted,
        async data => {
            console.log('TransactionExecuted:', data.message);
            // console.log("transaction hash:", data.transactionHash);
        },
    );
    aptos.transaction.batch.on(
        TransactionWorkerEventsEnum.TransactionSendFailed,
        async data => {
            // log event output
            console.log('TransactionSendFailed:', data.message);
        },
    );
    aptos.transaction.batch.on(
        TransactionWorkerEventsEnum.TransactionExecutionFailed,
        async data => {
            // log event output
            console.log('TransactionExecutionFailed:', data.message);
        },
    );
    aptos.transaction.batch.on(
        TransactionWorkerEventsEnum.ExecutionFinish,
        async data => {
            // log event output
            console.log(data.message);

            // verify accounts sequence number
            const senderAccountData = await aptos.getAccountInfo({
                accountAddress: sender.accountAddress,
            });
            console.log(
                `sender account's sequence number is ${senderAccountData.sequence_number}`,
            );

            // worker finished execution, we can now unsubscribe from event listeners
            aptos.transaction.batch.removeAllListeners();
            process.exit(0);
        },
    );
}

main();
