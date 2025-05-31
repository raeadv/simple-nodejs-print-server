// simple-print-service.js
const express = require("express");
const net = require("net");
const cors = require("cors");

const path = require("path");
const app = express();

const PORT = 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb" }));

// Test endpoint - GET /test
app.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "Print service is running",
    timestamp: new Date().toISOString(),
  });
});

// Print endpoint - POST /print
app.post("/print", async (req, res) => {
  try {
    const { ip, content } = req.body;

    // Validate required fields
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: "Printer IP is required",
      });
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Print content is required",
      });
    }

    console.log({
      message: "a print request received",
      printer: ip,
      content: content,
    });

    // Send to printer
    const result = await sendToPrinter(ip, content);
    // const result = await sendPrintCommand(ip, content);
    res.json(result);
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Function to send data to printer
async function sendToPrinter(ip, content, port = 9100, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    // // Convert content to raw printer commands
    // Set timeout
    const timeoutHandler = setTimeout(() => {
      socket.destroy();
      resolve({
        success: false,
        message: "Connection timeout",
        printer: `${ip}:${port}`,
      });
    }, timeout);

    // Connect to printer
    socket.connect(port, ip, () => {
      // Send content first (without cut command)
      const contentCommands = [];
      contentCommands.push(Buffer.from([0x1b, 0x40])); // ESC @

      contentCommands.push(Buffer.from(content, "utf8"));

      // contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF

      const contentData = Buffer.concat(contentCommands);

      socket.write(contentData);

      // cut after write
      const cutCommand = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0
      socket.write(cutCommand);

    });


    // Handle successful close
    socket.on("close", () => {
      if (!socket.destroyed) {
        clearTimeout(timeoutHandler);
        console.log(`Print job sent to ${ip}:${port}`);
        resolve({
          success: true,
          message: "Print job sent successfully",
          printer: `${ip}:${port}`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle errors
    socket.on("error", (err) => {
      clearTimeout(timeoutHandler);
      console.error(`Print error for ${ip}:${port}:`, err.message);
      resolve({
        success: false,
        message: `Print failed: ${err.message}`,
        printer: `${ip}:${port}`,
      });
    });
  });
}

// BLUETOOTH PRINT LIBRARY
const noble = require('@abandonware/noble');

// Bluetooth print endpoint - POST /print-bluetooth
app.post("/print-bluetooth", async (req, res) => {
  try {
    const { macAddress, content } = req.body;

    if (!macAddress) {
      return res.status(400).json({
        success: false,
        message: "Printer MAC address is required",
      });
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Print content is required",
      });
    }

    console.log({
      message: "Bluetooth print request received",
      printer: macAddress,
      content: content,
    });

    const result = await sendToBluetoothPrinter(macAddress, content);
    res.json(result);
  } catch (error) {
    console.error("Bluetooth print error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

async function sendToBluetoothPrinter(macAddress, content, timeout = 15000) {
  return new Promise((resolve) => {
    let isResolved = false;
    let targetPeripheral = null;
    let writeCharacteristic = null;

    const timeoutHandler = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        noble.stopScanning();
        if (targetPeripheral && targetPeripheral.state === 'connected') {
          targetPeripheral.disconnect();
        }
        resolve({
          success: false,
          message: "Bluetooth connection timeout",
          printer: macAddress,
        });
      }
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutHandler);
      noble.stopScanning();
    };

    // Start scanning when Bluetooth is ready
    noble.on('stateChange', (state) => {
      if (state === 'poweredOn') {
        console.log('Starting BLE scan for printer...');
        noble.startScanning([], false);
      }
    });

    // Handle discovered peripherals
    noble.on('discover', async (peripheral) => {
      const peripheralMac = peripheral.address.toLowerCase().replace(/:/g, '');
      const targetMac = macAddress.toLowerCase().replace(/:/g, '');
      
      if (peripheralMac === targetMac) {
        console.log(`Found target printer: ${peripheral.address}`);
        noble.stopScanning();
        targetPeripheral = peripheral;

        try {
          // Connect to peripheral
          await new Promise((connectResolve, connectReject) => {
            peripheral.connect((error) => {
              if (error) connectReject(error);
              else connectResolve();
            });
          });

          console.log('Connected to BLE printer');

          // Discover services and characteristics
          await new Promise((discoverResolve, discoverReject) => {
            peripheral.discoverAllServicesAndCharacteristics((error, services, characteristics) => {
              if (error) {
                discoverReject(error);
                return;
              }

              // Look for writable characteristic (common UUIDs for thermal printers)
              const commonWriteUUIDs = [
                '49535343-8841-43f4-a8d4-ecbe34729bb3', // Common thermal printer
                '0000ff02-0000-1000-8000-00805f9b34fb', // Another common UUID
                '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART TX
              ];

              writeCharacteristic = characteristics.find(char => 
                char.properties.includes('write') || 
                char.properties.includes('writeWithoutResponse') ||
                commonWriteUUIDs.includes(char.uuid.toLowerCase())
              );

              if (writeCharacteristic) {
                console.log(`Found write characteristic: ${writeCharacteristic.uuid}`);
                discoverResolve();
              } else {
                discoverReject(new Error('No writable characteristic found'));
              }
            });
          });

          // Prepare print data
          const commands = [];
          commands.push(Buffer.from([0x1b, 0x40])); // ESC @ (Initialize printer)
          commands.push(Buffer.from(content, "utf8"));
          commands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // Line feeds
          
          const printData = Buffer.concat(commands);
          
          // Send data in chunks (BLE has MTU limitations, usually 20-512 bytes)
          const chunkSize = 20; // Conservative chunk size
          for (let i = 0; i < printData.length; i += chunkSize) {
            const chunk = printData.slice(i, i + chunkSize);
            
            await new Promise((writeResolve, writeReject) => {
              writeCharacteristic.write(chunk, false, (error) => {
                if (error) writeReject(error);
                else writeResolve();
              });
            });
            
            // Small delay between chunks
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          // Send cut command
          const cutCommand = Buffer.from([0x1d, 0x56, 0x00]);
          await new Promise((writeResolve, writeReject) => {
            writeCharacteristic.write(cutCommand, false, (error) => {
              if (error) writeReject(error);
              else writeResolve();
            });
          });

          // Disconnect
          peripheral.disconnect();
          
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve({
              success: true,
              message: "BLE print job sent successfully",
              printer: macAddress,
              timestamp: new Date().toISOString(),
            });
          }

        } catch (error) {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            if (peripheral.state === 'connected') {
              peripheral.disconnect();
            }
            resolve({
              success: false,
              message: `BLE print error: ${error.message}`,
              printer: macAddress,
            });
          }
        }
      }
    });

    // Handle noble errors
    noble.on('warning', (message) => {
      console.log('Noble warning:', message);
    });

    // Start the process if Bluetooth is already powered on
    if (noble.state === 'poweredOn') {
      console.log('Starting BLE scan for printer...');
      noble.startScanning([], false);
    }
  });
}


// Start server
app.listen(PORT, () => {
  console.log(`
🖨️  Simple Print Service Started
📡 Port: ${PORT}
🌐 Test: http://localhost:${PORT}/test
  `);
});

// start another for test page
const testApp = express();
const TEST_PORT = 8000;

testApp.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "testpage.html"));
});


// Start server
testApp.listen(TEST_PORT, () => {
  console.log(`
🖨️  Test page started
📡 Port: ${TEST_PORT}
🌐 url: http://localhost:${TEST_PORT}/
  `);
});

// module.exports = app;
