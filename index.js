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
app.post("/print-v2", async (req, res) => {

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
    const result = await sendJobToPrinter(ip, content);
    res.json(result);
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }

})

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
    // const result = await sendToPrinter(ip, content);
    const result = await sendJobToPrinter(ip, content);
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

      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF

      const contentData = Buffer.concat(contentCommands);

      socket.write(contentData);

      socket.write(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]))

        // const cutCommand = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0
        // socket.write(cutCommand);

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

// using node-thermal-printer library
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;

async function sendJobToPrinter(ip, content, port = 9100, timeout = 5000) {
  return new Promise(async (resolve) => {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${ip}:${port}`,
      timeout: timeout
    });

    printer.alignCenter();
    let raw = await printer.raw(Buffer.from(content)); 
    // printer.println(content);
    // printer.newLine();
    printer.newLine();
    printer.cut();

    printer.execute()
      .then(() => {
        resolve({
          success: true,
          message: "Print job sent successfully",
          printer: `${ip}:${port}`,
          timestamp: new Date().toISOString(),
        });
      })
      .catch((err) => {
        resolve({
          success: false,
          message: `Print failed: ${err.message}`,
          printer: `${ip}:${port}`,
        });
      });
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
