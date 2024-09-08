const WebSocket = require('ws');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const wss = new WebSocket.Server({ port: 8080 });
const mongoUrl = process.env.MONGO_URL;
const dbName = process.env.DB_NAME;

let db;

const client = new MongoClient(mongoUrl, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function connectToMongo() {
  try {
    await client.connect();
    console.log('Successfully connected to MongoDB');
    db = client.db(dbName);

    setupWebSocketHandlers();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

connectToMongo();

// Function to set up WebSocket handlers once connected to the database
function setupWebSocketHandlers() {
  // Handle WebSocket connections
  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      const data = JSON.parse(message);

      // On ESP32 boot: get pill schedule
      if (data.type === 'get_schedule') {
        const patientId = data.patient_id;
        db.collection('schedules').findOne({ patient_id: patientId }, (err, schedule) => {
          if (err) throw err;
          // Send pill schedule back to ESP32
          ws.send(JSON.stringify({ type: 'schedule', schedule: schedule.schedule }));
        });
      }

      // Log pill taken or missed
      if (data.type === 'log_event') {
        const logEntry = {
          patient_id: data.patient_id,
          time_taken: data.time_taken,
          status: data.status,
        };
        db.collection('logs').insertOne(logEntry, (err, result) => {
          if (err) throw err;
          // Notify frontend that new data has been logged
          broadcastNewLog(logEntry);
        });
      }

      // Update pill schedule from frontend
      if (data.type === 'update_schedule') {
        const patientId = data.patient_id;
        const newSchedule = data.schedule;

        // Update schedule in the database
        db.collection('schedules').updateOne(
          { patient_id: patientId },
          { $set: { schedule: newSchedule } },
          (err, result) => {
            if (err) throw err;

            // Notify ESP32 about updated schedule
            broadcastNewSchedule(patientId, newSchedule);
          }
        );
      }
    });
  });
}

// Function to broadcast log data to all connected clients
function broadcastNewLog(logEntry) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'new_log', log: logEntry }));
    }
  });
}

// Function to broadcast updated schedule to ESP32
function broadcastNewSchedule(patientId, newSchedule) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'schedule_update', patient_id: patientId, schedule: newSchedule }));
    }
  });
}
