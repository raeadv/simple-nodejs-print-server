// Test script to demonstrate concurrent print job issues
// This sends multiple print requests simultaneously to test for race conditions

const axios = require('axios');

const SERVER_URL = 'http://localhost:8080';
const PRINTER_IP = '192.168.1.17'; // Change to your printer IP

const testContent = [
  ['TEST PRINT', 'HEADER 2', 'HEADER 3'],
  [
    ['Item 1', 'Price 1'],
    ['Item 2', 'Price 2']
  ],
  ['TOTAL: $10.00'],
  {
    "cashier": "TEST PRINT",
    "sales_id": "2025091302515368C4DC4976CCA",
    "orderType": "DINE-IN",
    "restaurantName": "Pondok Ale Ale Pontianak",
    "address": "Jl A Yani",
    "tax_number": "03.006241.02.003",
    "room": "VIP Kapuas",
    "table_info": "101",
    "order_date": "2025-09-13 09:51:52",
    "customer": "-",
    "note": null,
    "payments": [],
    "subtotal": 16000,
    "tax": 1680,
    "service_charge": 800,
    "discount": 0
  }
  //
  // {
  //   table_info: 'Table 1',
  //   order_date: '2025-01-01',
  //   orderType: 'Dine-in'
  // }
];

const printContent = [
  [
    "DINE-IN",
    "Test",
    "13/9/2025 10.15"
  ],
  [
    [
      "Test Menu xxx",
      "# Hanya Test"
    ]
  ],
  [],
  {
    "cashier": "TEST PRINT",
    "sales_id": "2025091302515368C4DC4976CCA",
    "orderType": "DINE-IN",
    "restaurantName": "Pondok Ale Ale Pontianak",
    "address": "Jl A Yani",
    "tax_number": "03.006241.02.003",
    "room": "VIP Kapuas",
    "table_info": "101",
    "order_date": "2025-09-13 09:51:52",
    "customer": "-",
    "note": null,
    "payments": [],
    "subtotal": 16000,
    "tax": 1680,
    "service_charge": 800,
    "discount": 0
  }
]


async function sendPrintJob(jobNumber) {
  try {
    const startTime = Date.now();
    console.log(`[Job ${jobNumber}] Sending request at ${startTime}...`);

    const response = await axios.post(`${SERVER_URL}/print`, {
      ip: PRINTER_IP,
      content: testContent,
      listOnly: true
    });

    const endTime = Date.now();
    console.log(`[Job ${jobNumber}] Response received in ${endTime - startTime}ms:`, response.data);

    return response.data;
  } catch (error) {
    console.error(`[Job ${jobNumber}] Error:`, error.message);
    return { success: false, error: error.message };
  }
}

async function testConcurrent() {
  console.log('=== Testing Concurrent Print Jobs ===\n');
  console.log('This test sends 5 print jobs simultaneously to demonstrate');
  console.log('potential race conditions in index.js\n');

  console.log('Sending 5 jobs at the same time...\n');

  // Send all jobs simultaneously
  const promises = [];
  for (let i = 1; i <= 5; i++) {
    promises.push(sendPrintJob(i));
  }

  const results = await Promise.all(promises);

  console.log('\n=== Results ===');
  results.forEach((result, index) => {
    console.log(`Job ${index + 1}:`, result.success ? '✅ Success' : '❌ Failed', result);
  });

  console.log('\n=== Expected Issues with index.js ===');
  console.log('1. Multiple TCP connections opened simultaneously');
  console.log('2. Printer may receive interleaved data');
  console.log('3. Some jobs may fail or produce corrupted output');
  console.log('4. No visibility into job order or status');

  console.log('\n=== With index-queue.js ===');
  console.log('1. Jobs processed one at a time');
  console.log('2. Guaranteed order (FIFO)');
  console.log('3. Automatic retry on failure');
  console.log('4. Full job tracking and status');
}

async function testSequential() {
  console.log('\n\n=== Testing Sequential Print Jobs (for comparison) ===\n');

  for (let i = 1; i <= 5; i++) {
    console.log(`Sending job ${i}...`);
    await sendPrintJob(i);
    // Wait 2 seconds between jobs
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\nSequential test completed.');
  console.log('With proper delays, jobs should succeed.');
}

// Run tests
(async () => {
  console.log('Make sure the server is running (node index.js or node index-queue.js)\n');

  // Test concurrent
  await testConcurrent();

  // Uncomment to test sequential
  // await testSequential();
})();
