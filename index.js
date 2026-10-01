// simple-print-service.js
const express = require("express");
const net = require("net");
const cors = require("cors");

const path = require("path");
const app = express();

//const Buffer = require("node:buffer");

const PORT = 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb" }));

// Test endpoint - GET /test
app.get("/test", (_, res) => {
  res.json({
    status: "ok",
    message: "Print service is running",
    timestamp: new Date().toISOString(),
  });
});

app.post("/test-print", async (req, res) => {
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
    const result = await testPrinter(ip, content);
    res.json(result);
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Print endpoint - POST /print
app.post("/print", async (req, res) => {
  try {
    const { ip, content, listOnly } = req.body;

    let qrString = null
    if (req.body.tdid) {
        qrString = req.body.tdid
    }

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
      content: req.body,
      listOnly: listOnly,
    });

    // Send to printer
    const result = await sendJobToPrinter(ip, content, listOnly, {qr: qrString});
    res.json(result);
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// using node-thermal-printer library
const ThermalPrinter = require("node-thermal-printer").printer;
const PrinterTypes = require("node-thermal-printer").types;

function sendJobToPrinter(
  ip,
  content,
  listOnly = false,
  optional = {}
) {

  const printerPort = 9100
  const printerTimeout = 5000

  return new Promise((resolve, _reject) => {
    let printer;
    try {
      printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${ip}:${printerPort}`,
        timeout: printerTimeout,
      });

      // Add debugging and validation
      console.log("Content received:", JSON.stringify(content, null, 2), ip, optional);
      
      // Validate content structure
      if (!Array.isArray(content) || content.length < 4) {
        throw new Error(`Invalid content format. Expected array with 4 elements, got: ${typeof content}`);
      }

      // 5th element is optional: extra blocks (e.g. untaxed items) printed
      // after the main summary, each preceded by a partial cut so they stay
      // on one strip of paper instead of separate receipts. Absent for every
      // print job that has nothing to split - fully backward compatible.
      const [header, list, summary, orderInfo, extraSections] = content;

      // Validate each component
      if (!Array.isArray(header)) {
        throw new Error(`Header must be an array, got: ${typeof header}`);
      }
      if (!Array.isArray(list)) {
        throw new Error(`List must be an array, got: ${typeof list}`);
      }
      if (!Array.isArray(summary)) {
        throw new Error(`Summary must be an array, got: ${typeof summary}`);
      }
      if (!orderInfo || typeof orderInfo !== 'object') {
        throw new Error(`OrderInfo must be an object, got: ${typeof orderInfo}`);
      }
      if (extraSections !== undefined && !Array.isArray(extraSections)) {
        throw new Error(`extraSections must be an array when present, got: ${typeof extraSections}`);
      }

      const printItemLines = (items) => {
        items.forEach((l) => {
          if (listOnly) {
            let ll = l[0] || '';
            if (l[1]) {
              ll += l[1] ? `  ${l[1]}` : '';
            }
            printer.println(ll);
          } else {
            printer.leftRight(l[0] || '', l[1] || '');
            if (l.length > 2) {
              printer.leftRight(l[3] || "");
            }
          }
        });
      };

      if (!listOnly) {
        printer.alignCenter();
        printer.bold(true);
        if (header.length > 0) {
          header.forEach((h) => {
            printer.println(h);
          });
        }
        printer.drawLine();
        printer.bold(false);
      } else {
        const { table_info, order_date, orderType } = orderInfo;

        printer.alignCenter();
        printer.bold(true);
        printer.println(`${orderType} | ${table_info}`);
        
        if(orderInfo?.printer_name) {
          printer.println(orderInfo.printer_name);
        }
        
        printer.println(order_date);
        
        if(orderInfo?.note) {
          printer.println(orderInfo.note);
        }
        printer.bold(false);
      }

      printer.alignLeft();
      if (list.length > 0) {
        printItemLines(list);
      }

      if (!listOnly) {
        printer.bold(true);
        printer.drawLine();
        printer.bold(false);
        printer.alignRight();
        if (summary.length > 0) {
          summary.forEach((s) => {
            printer.println(s);
          });
        }
      }

      if (!listOnly && Array.isArray(extraSections) && extraSections.length > 0) {
        extraSections.forEach((section) => {
          printer.partialCut();
          printer.println('');

          printer.alignLeft();
          printItemLines(section.list || []);

          printer.bold(true);
          printer.drawLine();
          printer.bold(false);
          printer.alignRight();
          (section.summary || []).forEach((s) => {
            printer.println(s);
          });
        });
      }


      if(optional.qr) {
        printer.alignCenter();
        printer.printQR(optional.qr, {
          cellSize: 8,
          model: 2,
        })
      }

      printer.cut();
      
      printer.execute()
        .then(() => {
          if (printer) printer.clear();
          resolve({
            success: true,
            message: "Print job sent successfully",
            printer: `${ip}:${printerPort}`,
            timestamp: new Date().toISOString(),
          });
        })
        .catch((err) => {
          if (printer) printer.clear();
          resolve({
            success: false,
            message: `Print failed 01 : ${err.message}`,
            printer: `${ip}:${printerPort}`,
          });
        });
    } catch (err) {
      if (printer) printer.clear();
      return resolve({
        success: false,
        message: `Print failed 02: ${err.message}`,
        printer: `${ip}:${printerPort}`,
      });
    }
  });
}

// for testing purpose
function testPrinter(ip, content, port = 9100, timeout = 5000) {
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
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF

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

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

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

testApp.get("/", (_, res) => {
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
