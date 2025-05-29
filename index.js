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

    // Convert content to raw printer commands
    const commands = [];

    // Initialize printer
    commands.push(Buffer.from([0x1b, 0x40])); // ESC @

    // Add content
    commands.push(Buffer.from(content, "utf8"));

    // Add 2 blank lines
    commands.push(Buffer.from([0x0a /*, 0x0a*/])); // LF LF

    // Cut paper
    commands.push(Buffer.from([0x1d, 0x56, 0x00])); // GS V 0 (full cut)

    const rawData = Buffer.concat(commands);

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
      socket.write(rawData);
      socket.end();
      clearTimeout(timeoutHandler);

      console.log(`Print job sent to ${ip}:${port}`);
      resolve({
        success: true,
        message: "Print job sent successfully",
        printer: `${ip}:${port}`,
        timestamp: new Date().toISOString(),
      });
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

testApp.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "testpage.html"));
});

// Start server
testApp.listen(8000, () => {
  console.log(`
🖨️  Test page started
📡 Port: 8000
🌐 url: http://localhost:8000/
  `);
});

// module.exports = app;
