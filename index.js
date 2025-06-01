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
    const { ip, content, listOnly, context } = req.body;

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
      listOnly: listOnly,
      context: context,
    });

    // Send to printer
    // const result = await sendToPrinter(ip, content);
    const result = await sendJobToPrinter(ip, content, context, listOnly,);
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
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;

async function sendJobToPrinter(ip, content,context, listOnly = false, port = 9100, timeout = 5000) {
  return new Promise(async (resolve) => {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${ip}:${port}`,
      timeout: timeout
    });

    const [header, list, summary] = content

    
    if(!listOnly){
        printer.newLine();
        printer.alignCenter();
        printer.bold(true);  
        if(header.length > 0) {
          header.forEach(h => {
            printer.println(h)
          });
        }
        printer.bold(false);  
      } else {

        const {table_info, order_date} = context
        
        printer.alignCenter();
        printer.bold(true);  
        printer.println(table_info)
        printer.println(order_date)
        printer.bold(false);  
    }
    printer.drawLine(); 

    printer.alignLeft(); 
    if(list.length > 0) {
      list.forEach(l => {
        if(listOnly) {
            printer.println(l[0] +'  '+ l[1] || '')
            // printer.alignCenter(l.join(' '))
        } else {
          printer.leftRight(l[0], l[1]);
          if(l.length > 2) {
            printer.leftRight(l[3] || '');
          } 
        }
      
      });
    }

    if(!listOnly){
      printer.drawLine(); 
      printer.alignRight();
      if(summary.length > 0) {
        summary.forEach(s => {
          printer.println(s)
        });
      }
    }

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
