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

function setupWebSocketHandlers() {
  wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        if (!data.type) {
          console.error('Invalid message type');
          return;
        }

        switch (data.type) {
          case 'get_schedule':
            await handleGetSchedule(ws, data);
            break;
          
          case 'log_event':
            await handleLogEvent(data);
            break;
          
          case 'update_schedule':
            await handleUpdateSchedule(data);
            break;
          
          default:
            console.error('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Error processing message:', err);
      }
    });
  });
}

async function handleGetSchedule(ws, data) {
  const patientId = data.patient_id;
  if (!patientId) {
    console.error('Missing patient_id in get_schedule message');
    return;
  }

  try {
    const schedule = await db.collection('schedules').findOne({ patient_id: patientId });
    if (!schedule) {
      console.log('No schedule found for patient_id:', patientId);
      ws.send(JSON.stringify({ type: 'schedule', schedule: null }));
      return;
    }
    ws.send(JSON.stringify({ type: 'schedule', schedule: schedule.schedule }));
  } catch (err) {
    console.error('Error fetching schedule:', err);
  }
}

async function handleLogEvent(data) {
  const logEntry = {
    patient_id: data.patient_id,
    time_taken: data.time_taken,
    status: data.status,
  };

  try {
    const result = await db.collection('logs').insertOne(logEntry);
    console.log('Log entry inserted:', result.insertedId);
    broadcastNewLog(logEntry);
  } catch (err) {
    console.error('Error inserting log entry:', err);
  }
}

async function handleUpdateSchedule(data) {
  const patientId = data.patient_id;
  const newSchedule = data.schedule;

  // if (!patientId || !Array.isArray(newSchedule)) {
  //   console.error('Invalid data for update_schedule message');
  //   return;
  // }

  try {
    const result = await db.collection('schedules').updateOne(
      { patient_id: patientId },
      { $set: { schedule: newSchedule } },
      { upsert: true }
    );
    
    if (result.matchedCount === 0) {
      console.log('No document matched the query; a new document was created for patient_id:', patientId);
    } else if (result.modifiedCount === 0) {
      console.log('Document matched but not modified for patient_id:', patientId);
    } else {
      console.log('Schedule updated for patient_id:', patientId);
    }

    broadcastNewSchedule(patientId, newSchedule);
  } catch (err) {
    console.error('Error updating schedule:', err);
  }
}

function broadcastNewLog(logEntry) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'new_log', log: logEntry }));
    }
  });
}

function broadcastNewSchedule(patientId, newSchedule) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'schedule_update', patient_id: patientId, schedule: newSchedule }));
    }
  });
}
