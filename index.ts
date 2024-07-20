import axios from 'axios';
import * as fs from 'fs';
import * as csv from 'csv-stringify/sync';
import csvParser from 'csv-parser';
import path from 'path';
import api from '@actual-app/api';

const overwrite = process.argv.includes('--overwrite');

// Read the config file
const configPath = path.resolve(__dirname, 'config.json');
const configData = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(configData);

async function downloadUpData(apiKey: string) {
    console.log('Downloading data from Up...');
    const baseUrl = 'https://api.up.com.au/api/v1';
    const headers = { Authorization: `Bearer ${apiKey}` };
  
    try {
      // Get all accounts
      const accountsResponse = await axios.get(`${baseUrl}/accounts`, { headers });
      const accounts = accountsResponse.data.data;
  
      let allTransactions: any[] = [];
  
    // Fetch transactions for each account
    for (const account of accounts) {
      let nextUrl = `${baseUrl}/accounts/${account.id}/transactions`;
      let transactionCount = 0; // Counter for tracking the number of transactions fetched so we can do some crude rate clientside limiting
  
      while (nextUrl && transactionCount < 1000) {
        const transactionsResponse = await axios.get(nextUrl, { headers });
        const transactions = transactionsResponse.data.data;
        allTransactions = allTransactions.concat(transactions);
        transactionCount += transactions.length;
        nextUrl = transactionsResponse.data.links.next;
      }
    }
  
      // Transform transactions data for CSV
      const csvData = allTransactions.map(transaction => ({
        id: transaction.id,
        status: transaction.attributes.status,
        rawText: transaction.attributes.rawText,
        description: transaction.attributes.description,
        message: transaction.attributes.message,
        holdInfo: transaction.attributes.holdInfo,
        amount: transaction.attributes.amount.value,
        settledAt: transaction.attributes.settledAt,
        createdAt: transaction.attributes.createdAt
      }));

    // Write to CSV file
    const csvString = csv.stringify(csvData, { header: true });
    const csvFilePath = path.resolve(__dirname, config.csvFilePath);
    fs.writeFileSync(csvFilePath, csvString);
      console.log('CSV file ', config.csvFilePath, ' has been created successfully.');
    } 
    catch (error) {
      console.error('Error downloading Up data:', error);
    }
}

// Define the transaction interface
interface Transaction {
    id: string;
    date: string;
    amount: number;
    payee_name: string;
    imported_payee: string;
    notes: string;
    category: string;
}
  
// Import CSV data
async function importCsvData(csvFilePath: string, accountName: string) {
    try {
        // Wait for the CSV file to exist
        while (!fs.existsSync(csvFilePath)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Initialize the API
        await api.init({
            serverURL: config.serverURL,
            password: config.password
        });
        console.log('API initialized successfully');

        // Read and parse the CSV file
        const transactions: Transaction[] = await parseCSV(csvFilePath);

        // Format transactions for Actual Budget API
        const formattedTransactions = transactions.map(t => ({
            ...t,
            imported_id: t.id,
            account: accountName
        }));

        // Run the import
        if (config.EE2E) {
            console.log('End to end encryption enabled. Downloading budget data using provided password...');
            await api.downloadBudget(config.budgetId, { 
                password: config.encryptionPassword });
        }
        else {
            console.log('Downloading budget data...');
            await api.downloadBudget(config.budgetId);
        }
        await api.addTransactions(accountName, formattedTransactions);
        console.log('Transactions added successfully');
    } 
    catch (error) {
        if (error instanceof ApiInitializationError) {
            console.error('Failed to initialize API:', error.message);
            process.exit(1);
        } else if (error instanceof CsvParseError) {
            console.error('Error parsing CSV file:', error.message);
        } else if (error instanceof TransactionAddError) {
            console.error('Error adding transactions:', error.message);
        } else {
            console.error('Unexpected error:', error);
        }
    }
    finally {
        // Ensure API connection is always closed
        try {
            await api.shutdown();
        } catch (shutdownError) {
            console.error('Error during API shutdown:', shutdownError);
        }
    }
}

async function parseCSV(filePath: string): Promise<Transaction[]> {
    return new Promise((resolve, reject) => {
        const results: Transaction[] = [];
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data: { id: any; createdAt: string; amount: string; description: any; rawText: any; message: any; }) => {
                const transaction: Transaction = {
                    id: data.id,
                    date: data.createdAt ? data.createdAt.split('T')[0] : '',
                    amount: parseInt(data.amount) * 100,
                    payee_name: data.description,
                    imported_payee: data.rawText || data.description,
                    notes: data.message || '',
                    category: ''
                };
                results.push(transaction);
            })
            .on('end', () => resolve(results))
            .on('error', (error: { message: string | undefined; }) => reject(new CsvParseError(error.message)));
    });
}

class ApiInitializationError extends Error {}
class CsvParseError extends Error {}
class TransactionAddError extends Error {}

// Main script
const apiKey = config.apiKey;

if (apiKey) {
    if (overwrite && fs.existsSync(config.csvFilePath)) {
        console.log('CSV file already exists, but overwrite flag given. Downloading Up data and overwriting the CSV file.');
        downloadUpData(apiKey);
        importCsvData(config.csvFilePath, config.accountName);
    } 
    else if (fs.existsSync(config.csvFilePath)) {
        console.log('CSV file already exists. Skipping the download step.');
        importCsvData(config.csvFilePath, config.accountName);
    }
    else {
        console.log('CSV file does not exist. Downloading first.');
        downloadUpData(apiKey);
        importCsvData(config.csvFilePath, config.accountName);
    }
} 
else {
    console.log('Up API key is missing in the config file, skipping the download step.');
    importCsvData(config.csvFilePath, config.accountName);
}
