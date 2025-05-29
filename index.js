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



const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Send content and return socket after content is fully printed
async function sendContentToPrinter(ip, content, port = 9100, timeout = 5000, printDelay = 2000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    
    const timeoutHandler = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, timeout);
    
    socket.connect(port, ip, () => {
      clearTimeout(timeoutHandler);
      
      // Prepare content commands (without cut)
      const contentCommands = [];
      contentCommands.push(Buffer.from([0x1b, 0x40])); // ESC @ (initialize)
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      contentCommands.push(Buffer.from(content, "utf8"));
      contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
      
      const contentData = Buffer.concat(contentCommands);
      
      socket.write(contentData, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Wait for data to be sent
        const waitForDrain = () => {
          if (socket.writableNeedDrain) {
            socket.once('drain', proceedAfterSend);
          } else {
            proceedAfterSend();
          }
        };
        
        const proceedAfterSend = () => {
          console.log(`Content sent to ${ip}:${port}, waiting ${printDelay}ms for printing...`);
          
          // Wait for printing to complete, then return socket
          setTimeout(() => {
            console.log(`Content should be printed, returning socket for ${ip}:${port}`);
            resolve(socket); // Return the active socket
          }, printDelay);
        };
        
        waitForDrain();
      });
    });
    
    socket.on('error', (err) => {
      clearTimeout(timeoutHandler);
      reject(err);
    });
  });
}

// Send cut command using existing socket
async function sendCutCommand(socket) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error('Socket is already destroyed'));
      return;
    }
    
    const cutCommand = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 (full cut)
    
    socket.write(cutCommand, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log('Cut command sent');
      
      // Wait a bit for cut to complete, then close socket
      setTimeout(() => {
        socket.end();
        socket.once('close', () => {
          console.log('Socket closed after cut');
          resolve({
            success: true,
            message: "Cut command sent and socket closed",
          });
        });
        
        // Force close if needed
        setTimeout(() => {
          if (!socket.destroyed) {
            socket.destroy();
            resolve({
              success: true,
              message: "Cut command sent and socket force closed",
            });
          }
        }, 1000);
      }, 500);
    });
  });
}

// Main function that combines both operations
async function sendToPrinter(ip, content, port = 9100, timeout = 5000, printDelay = 2000) {
  try {
    console.log(`Starting print job for ${ip}:${port}...`);
    
    // Send content and get socket back when printing is done
    const socket = await sendContentToPrinter(ip, content, port, timeout, printDelay);
    
    // Now send cut command using the same socket
    const cutResult = await sendCutCommand(socket);
    
    console.log(`Print job completed successfully for ${ip}:${port}`);
    return {
      success: true,
      message: "Print job sent successfully with cut",
      printer: `${ip}:${port}`,
      timestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error(`Print error for ${ip}:${port}:`, error.message);
    return {
      success: false,
      message: `Print failed: ${error.message}`,
      printer: `${ip}:${port}`,
    };
  }
}

// Alternative: Using .then() syntax as you suggested
function sendToPrinterWithThen(ip, content, port = 9100, timeout = 5000, printDelay = 2000) {
  return sendContentToPrinter(ip, content, port, timeout, printDelay)
    .then(socket => {
      console.log('Content printed, now sending cut command...');
      return sendCutCommand(socket);
    })
    .then(result => {
      console.log(`Print job completed successfully for ${ip}:${port}`);
      return {
        success: true,
        message: "Print job sent successfully with cut",
        printer: `${ip}:${port}`,
        timestamp: new Date().toISOString(),
      };
    })
    .catch(error => {
      console.error(`Print error for ${ip}:${port}:`, error.message);
      return {
        success: false,
        message: `Print failed: ${error.message}`,
        printer: `${ip}:${port}`,
      };
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
