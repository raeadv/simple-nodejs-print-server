// simple-print-service-queue.js
const express = require("express");
const net = require("net");
const cors = require("cors");
const path = require("path");
const ThermalPrinter = require("node-thermal-printer").printer;
const PrinterTypes = require("node-thermal-printer").types;

const app = express();
const PORT = 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ limit: "10mb" }));

// Queue implementation
class PrintQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.jobIdCounter = 1;
    this.completedJobs = [];
    this.maxCompletedJobs = 100; // Keep last 100 completed jobs
  }

  addJob(ip, content, listOnly = false, jobType = 'print') {
    const job = {
      id: this.jobIdCounter++,
      ip,
      content,
      listOnly,
      jobType,
      status: 'pending',
      addedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3,
      error: null
    };

    this.queue.push(job);
    console.log(`Job #${job.id} added to queue. Queue size: ${this.queue.length}`);

    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }

    return job.id;
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue[0];
      job.status = 'processing';
      job.processingAt = new Date().toISOString();
      job.attempts++;

      console.log(`Processing job #${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);

      try {
        let result;
        if (job.jobType === 'test-print') {
          result = await this.testPrinter(job.ip, job.content);
        } else {
          result = await this.sendJobToPrinter(job.ip, job.content, job.listOnly);
        }

        if (result.success) {
          job.status = 'completed';
          job.completedAt = new Date().toISOString();
          job.result = result;
          console.log(`Job #${job.id} completed successfully`);

          // Move to completed jobs
          this.completedJobs.unshift(job);
          if (this.completedJobs.length > this.maxCompletedJobs) {
            this.completedJobs.pop();
          }

          // Remove from queue
          this.queue.shift();
        } else {
          // Job failed
          if (job.attempts >= job.maxAttempts) {
            job.status = 'failed';
            job.error = result.message;
            job.failedAt = new Date().toISOString();
            console.log(`Job #${job.id} failed after ${job.attempts} attempts: ${result.message}`);

            // Move to completed jobs
            this.completedJobs.unshift(job);
            if (this.completedJobs.length > this.maxCompletedJobs) {
              this.completedJobs.pop();
            }

            // Remove from queue
            this.queue.shift();
          } else {
            // Retry
            job.status = 'pending';
            job.error = result.message;
            console.log(`Job #${job.id} failed, will retry. Error: ${result.message}`);

            // Move to end of queue for retry
            this.queue.shift();
            this.queue.push(job);
          }
        }
      } catch (error) {
        console.error(`Job #${job.id} processing error:`, error);
        job.error = error.message;

        if (job.attempts >= job.maxAttempts) {
          job.status = 'failed';
          job.failedAt = new Date().toISOString();

          // Move to completed jobs
          this.completedJobs.unshift(job);
          if (this.completedJobs.length > this.maxCompletedJobs) {
            this.completedJobs.pop();
          }

          // Remove from queue
          this.queue.shift();
        } else {
          // Retry
          job.status = 'pending';

          // Move to end of queue for retry
          this.queue.shift();
          this.queue.push(job);
        }
      }

      // Small delay between jobs to prevent overwhelming the printer
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.isProcessing = false;
    console.log('Queue processing completed. Queue is now empty.');
  }

  getJob(jobId) {
    // Check in active queue
    const queuedJob = this.queue.find(j => j.id === jobId);
    if (queuedJob) return queuedJob;

    // Check in completed jobs
    return this.completedJobs.find(j => j.id === jobId);
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      pendingJobs: this.queue.filter(j => j.status === 'pending').length,
      processingJobs: this.queue.filter(j => j.status === 'processing').length,
      completedJobsCount: this.completedJobs.length,
      jobs: this.queue.map(j => ({
        id: j.id,
        status: j.status,
        ip: j.ip,
        attempts: j.attempts,
        addedAt: j.addedAt,
        error: j.error
      }))
    };
  }

  getAllJobs(limit = 50) {
    const activeJobs = this.queue.map(j => ({ ...j, active: true }));
    const completedJobsSlice = this.completedJobs.slice(0, limit - activeJobs.length);
    return [...activeJobs, ...completedJobsSlice];
  }

  retryJob(jobId) {
    const job = this.completedJobs.find(j => j.id === jobId && j.status === 'failed');

    if (!job) {
      return { success: false, message: 'Job not found or not failed' };
    }

    // Remove from completed jobs
    const index = this.completedJobs.indexOf(job);
    this.completedJobs.splice(index, 1);

    // Reset job and add back to queue
    job.status = 'pending';
    job.attempts = 0;
    job.error = null;
    job.retriedAt = new Date().toISOString();
    this.queue.push(job);

    console.log(`Job #${job.id} re-queued for retry`);

    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }

    return { success: true, message: `Job #${jobId} re-queued` };
  }

  clearCompleted() {
    const count = this.completedJobs.length;
    this.completedJobs = [];
    return { success: true, message: `Cleared ${count} completed jobs` };
  }

  sendJobToPrinter(ip, content, listOnly = false, port = 9100, timeout = 5000) {
    return new Promise((resolve) => {
      let printer;
      try {
        printer = new ThermalPrinter({
          type: PrinterTypes.EPSON,
          interface: `tcp://${ip}:${port}`,
          timeout: timeout,
        });

        // Validate content structure
        if (!Array.isArray(content) || content.length < 4) {
          throw new Error(`Invalid content format. Expected array with 4 elements, got: ${typeof content}`);
        }

        const [header, list, summary, orderInfo] = content;

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
          printer.println(order_date);
          printer.bold(false);
        }

        printer.alignLeft();
        if (list.length > 0) {
          list.forEach((l) => {
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

        printer.cut();

        printer.execute()
          .then(() => {
            if (printer) printer.clear();
            resolve({
              success: true,
              message: "Print job sent successfully",
              printer: `${ip}:${port}`,
              timestamp: new Date().toISOString(),
            });
          })
          .catch((err) => {
            if (printer) printer.clear();
            resolve({
              success: false,
              message: `Print failed 01 : ${err.message}`,
              printer: `${ip}:${port}`,
            });
          });
      } catch (err) {
        if (printer) printer.clear();
        return resolve({
          success: false,
          message: `Print failed 02: ${err.message}`,
          printer: `${ip}:${port}`,
        });
      }
    });
  }

  testPrinter(ip, content, port = 9100, timeout = 5000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      const timeoutHandler = setTimeout(() => {
        socket.destroy();
        resolve({
          success: false,
          message: "Connection timeout",
          printer: `${ip}:${port}`,
        });
      }, timeout);

      socket.connect(port, ip, () => {
        const contentCommands = [];
        contentCommands.push(Buffer.from([0x1b, 0x40])); // ESC @
        contentCommands.push(Buffer.from(content, "utf8"));
        contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF

        const contentData = Buffer.concat(contentCommands);
        socket.write(contentData);

        contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
        contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
        contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF
        contentCommands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])); // LF LF

        const cutCommand = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0
        socket.write(cutCommand);
      });

      socket.on("close", () => {
        if (!socket.destroyed) {
          clearTimeout(timeoutHandler);
          resolve({
            success: true,
            message: "Print job sent successfully",
            printer: `${ip}:${port}`,
            timestamp: new Date().toISOString(),
          });
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timeoutHandler);
        resolve({
          success: false,
          message: `Print failed: ${err.message}`,
          printer: `${ip}:${port}`,
        });
      });
    });
  }
}

// Initialize queue
const printQueue = new PrintQueue();

// Test endpoint - GET /test
app.get("/test", (_, res) => {
  res.json({
    status: "ok",
    message: "Print service with queue is running",
    timestamp: new Date().toISOString(),
    queueStatus: printQueue.getQueueStatus()
  });
});

// Test print endpoint - POST /test-print
app.post("/test-print", async (req, res) => {
  try {
    const { ip, content } = req.body;

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
      message: "a test print request received",
      printer: ip,
      content: content,
    });

    // Add to queue
    const jobId = printQueue.addJob(ip, content, false, 'test-print');

    res.json({
      success: true,
      message: "Print job added to queue",
      jobId: jobId,
      queuePosition: printQueue.queue.length
    });
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
    });

    // Add to queue
    const jobId = printQueue.addJob(ip, content, listOnly, 'print');

    res.json({
      success: true,
      message: "Print job added to queue",
      jobId: jobId,
      queuePosition: printQueue.queue.length
    });
  } catch (error) {
    console.error("Print error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Queue status endpoint - GET /queue/status
app.get("/queue/status", (_, res) => {
  res.json(printQueue.getQueueStatus());
});

// Get job status - GET /queue/job/:id
app.get("/queue/job/:id", (req, res) => {
  const jobId = parseInt(req.params.id);
  const job = printQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: "Job not found"
    });
  }

  res.json({
    success: true,
    job: job
  });
});

// Get all jobs - GET /queue/jobs
app.get("/queue/jobs", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const jobs = printQueue.getAllJobs(limit);

  res.json({
    success: true,
    total: jobs.length,
    jobs: jobs
  });
});

// Retry failed job - POST /queue/retry/:id
app.post("/queue/retry/:id", (req, res) => {
  const jobId = parseInt(req.params.id);
  const result = printQueue.retryJob(jobId);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

// Clear completed jobs - POST /queue/clear
app.post("/queue/clear", (_, res) => {
  const result = printQueue.clearCompleted();
  res.json(result);
});

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
🖨️  Simple Print Service with Queue Started
📡 Port: ${PORT}
🌐 Test: http://localhost:${PORT}/test
📋 Queue Status: http://localhost:${PORT}/queue/status
  `);
});

// Start test page server
const testApp = express();
const TEST_PORT = 8000;

testApp.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "testpage.html"));
});

testApp.listen(TEST_PORT, () => {
  console.log(`
🖨️  Test page started
📡 Port: ${TEST_PORT}
🌐 url: http://localhost:${TEST_PORT}/
  `);
});
