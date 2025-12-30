const mongoose = require('mongoose');

const connection = {};

async function connectDb(retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  try {
    // Check if already connected
    if (connection.isConnected) {
      // Verify connection is still alive
      if (mongoose.connection.readyState === 1) {
        return;
      } else {
        connection.isConnected = false;
      }
    }
    
    // Check existing connections
    if (mongoose.connections.length > 0) {
      const readyState = mongoose.connections[0].readyState;
      if (readyState === 1) {
        connection.isConnected = 1;
        return;
      }
      // Disconnect if connection is in bad state
      if (readyState === 3 || readyState === 0) {
        try {
          await mongoose.disconnect();
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
      }
    }
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }
    
    // Validate MongoDB URI format
    if (!process.env.MONGODB_URI.startsWith('mongodb://') && !process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
      throw new Error('Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://');
    }
    
    console.log(`🔄 Attempting to connect to MongoDB... (attempt ${retryCount + 1}/${maxRetries + 1})`);
    
    // Connect with improved options for stability
    const db = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000, // 30 seconds timeout (increased from 10)
      socketTimeoutMS: 60000, // 60 seconds socket timeout (increased from 45)
      connectTimeoutMS: 30000, // 30 seconds connection timeout (increased from 10)
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 0, // Don't maintain minimum connections (set to 0 to avoid hanging)
      retryWrites: true, // Enable retry writes
      retryReads: true, // Enable retry reads
      heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
    });
    
    connection.isConnected = db.connections[0].readyState;
    console.log('✅ New connection to the database.');
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    
    // Provide helpful error messages
    if (error.name === 'MongooseServerSelectionError' || error.message.includes('Server selection timed out')) {
      console.error('⚠️  MongoDB server is not reachable. Please check:');
      console.error('   1. MongoDB server is running');
      console.error('   2. MONGODB_URI is correct in .env file');
      console.error('   3. Network/firewall allows connection');
      console.error(`   4. Connection string: ${process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : 'NOT SET'}`);
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('⚠️  Connection refused. MongoDB server might not be running.');
    } else if (error.message.includes('authentication failed')) {
      console.error('⚠️  Authentication failed. Please check username and password in MONGODB_URI.');
    }
    
    // Retry logic
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying database connection... (${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
      return connectDb(retryCount + 1);
    }
    
    // Reset connection state on final failure
    connection.isConnected = false;
    console.error('❌ Failed to connect to database after all retries.');
    throw error;
  }
}

async function disconnectDb() {
  if (connection.isConnected) {
    if (process.env.NODE_ENV === 'production') {
      await mongoose.disconnect();
      connection.isConnected = false;
      console.log('Disconnected from the database.');
    } else {
      console.log('Not disconnecting from the database (development mode).');
    }
  }
}

// Check if database is connected
function isConnected() {
  return connection.isConnected === 1 && mongoose.connection.readyState === 1;
}

// Get connection state
function getConnectionState() {
  return {
    isConnected: connection.isConnected === 1,
    readyState: mongoose.connection.readyState,
    readyStateText: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown'
  };
}

// Handle connection events
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  connection.isConnected = false;
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
  connection.isConnected = false;
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
  connection.isConnected = 1;
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected');
  connection.isConnected = 1;
});

mongoose.connection.on('connecting', () => {
  console.log('🔄 MongoDB connecting...');
});

mongoose.connection.on('close', () => {
  console.log('MongoDB connection closed');
  connection.isConnected = false;
});

module.exports = { connectDb, disconnectDb, isConnected, getConnectionState };

