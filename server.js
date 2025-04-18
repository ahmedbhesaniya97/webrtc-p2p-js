// // server.js
// const WebSocket = require('ws');
// const http = require('http');
// const express = require('express');
// const path = require('path');

// const app = express();
// const port = process.env.PORT || 3000;

// // Serve static files from the public directory
// app.use(express.static(path.join(__dirname, 'public')));

// // Create HTTP server
// const server = http.createServer(app);

// // Create WebSocket server
// const wss = new WebSocket.Server({ server });

// // Keep track of connected clients
// const clients = new Map();
// let clientIdCounter = 0;

// // WebSocket connection handling
// wss.on('connection', (ws) => {
//   const clientId = clientIdCounter++;
//   clients.set(ws, { id: clientId });

//   console.log(`Client ${clientId} connected. Total clients: ${clients.size}`);

//   // Send the client their ID
//   ws.send(JSON.stringify({
//     type: 'id',
//     id: clientId
//   }));

//   // Send list of connected peers
//   const peerIds = Array.from(clients.values())
//     .map(client => client.id)
//     .filter(id => id !== clientId);

//   ws.send(JSON.stringify({
//     type: 'peers',
//     peerIds
//   }));

//   // Inform other clients about new peer
//   clients.forEach((client, clientWs) => {
//     if (clientWs !== ws) {
//       clientWs.send(JSON.stringify({
//         type: 'new-peer',
//         peerId: clientId
//       }));
//     }
//   });

//   // Message handling
//   ws.on('message', (message) => {
//     try {
//       const data = JSON.parse(message);
//       console.log(`Message from client ${clientId}:`, data.type);

//       // Handle signaling messages (forward to the appropriate peer)
//       if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
//         const targetId = data.target;
//         const targetClient = Array.from(clients.entries())
//           .find(([_, client]) => client.id === targetId);

//         if (targetClient) {
//           const [targetWs] = targetClient;
//           data.from = clientId;
//           targetWs.send(JSON.stringify(data));
//         }
//       }
//     } catch (e) {
//       console.error('Error parsing message:', e);
//     }
//   });

//   // Handle client disconnection
//   ws.on('close', () => {
//     const disconnectedClientId = clients.get(ws).id;
//     clients.delete(ws);

//     console.log(`Client ${disconnectedClientId} disconnected. Total clients: ${clients.size}`);

//     // Inform remaining clients about the disconnection
//     clients.forEach((client, clientWs) => {
//       clientWs.send(JSON.stringify({
//         type: 'peer-disconnected',
//         peerId: disconnectedClientId
//       }));
//     });
//   });
// });

// // Start the server
// server.listen(port, () => {
//   console.log(`Server running on http://localhost:${port}`);
// });

// MQTT Broker Server for WebRTC Signaling
const aedes = require("aedes")();
const ws = require("websocket-stream");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Configuration
const config = {
  // HTTP server for WebSocket connections
  httpPort: process.env.HTTP_PORT || 8888,

  // Secure WebSocket server (WSS) for production use
  httpsPort: process.env.HTTPS_PORT || 8443,

  // SSL certificates for HTTPS/WSS (required for production)
  ssl: {
    key:
      process.env.SSL_KEY_PATH || path.join(__dirname, "certs", "server.key"),
    cert:
      process.env.SSL_CERT_PATH || path.join(__dirname, "certs", "server.cert"),
  },

  // Whether to enable the secure server
  enableHttps: process.env.ENABLE_HTTPS === "true" || false,

  // Whether to enable basic authentication
  enableAuth: process.env.ENABLE_AUTH === "true" || false,

  // Basic auth credentials (should be stored securely in production)
  credentials: {
    username: process.env.AUTH_USERNAME || "webrtc",
    password: process.env.AUTH_PASSWORD || "signaling",
  },
};

// Create HTTP server
const httpServer = http.createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() })
    );
    return;
  }

  // Default response
  res.writeHead(404);
  res.end();
});

// Create HTTPS server if enabled
let httpsServer;
if (config.enableHttps) {
  try {
    const https = require("https");
    const options = {
      key: fs.readFileSync(config.ssl.key),
      cert: fs.readFileSync(config.ssl.cert),
    };
    httpsServer = https.createServer(options, (req, res) => {
      // Simple health check endpoint
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", timestamp: new Date().toISOString() })
        );
        return;
      }

      // Default response
      res.writeHead(404);
      res.end();
    });
  } catch (err) {
    console.error("Failed to load SSL certificates:", err.message);
    console.warn("HTTPS server will not be started.");
    config.enableHttps = false;
  }
}

// Setup WebSocket server for MQTT over WebSockets
ws.createServer({ server: httpServer }, aedes.handle);

// Setup secure WebSocket server if enabled
if (config.enableHttps && httpsServer) {
  ws.createServer({ server: httpsServer }, aedes.handle);
}

// Start HTTP server
httpServer.listen(config.httpPort, () => {
  console.log(
    `MQTT WebSocket server listening on ws://localhost:${config.httpPort}`
  );
});

// Start HTTPS server if enabled
if (config.enableHttps && httpsServer) {
  httpsServer.listen(config.httpsPort, () => {
    console.log(
      `MQTT WebSocket secure server listening on wss://localhost:${config.httpsPort}`
    );
  });
}

// Implement basic authentication if enabled
if (config.enableAuth) {
  aedes.authenticate = (client, username, password, callback) => {
    const authorized =
      username === config.credentials.username &&
      password.toString() === config.credentials.password;

    if (authorized) {
      console.log(`Client authenticated: ${client.id}`);
      callback(null, authorized);
    } else {
      console.log(`Authentication failed for client: ${client.id}`);
      const error = new Error("Authentication failed");
      error.returnCode = 4; // Bad username or password
      callback(error, null);
    }
  };
}

// MQTT Server Events

// Client connected
aedes.on("client", (client) => {
  console.log(`Client connected: ${client.id}`);
});

// Client disconnected
aedes.on("clientDisconnect", (client) => {
  console.log(`Client disconnected: ${client.id}`);
});

// Published message
aedes.on("publish", (packet, client) => {
  if (client) {
    // Log WebRTC signaling messages for debugging
    if (packet.topic.includes("webrtc/")) {
      // Parse the message to get room and message type
      const topicParts = packet.topic.split("/");
      const roomId = topicParts[1];
      const messageType = topicParts[2];

      let messageContent;
      try {
        messageContent = JSON.parse(packet.payload.toString());
        const clientId = messageContent.clientId || "unknown";

        // Log different message types differently
        if (messageType === "presence") {
          console.log(
            `Room ${roomId}: Client ${clientId} sent presence message: ${messageContent.type}`
          );
        } else if (messageType === "signal") {
          console.log(
            `Room ${roomId}: Client ${clientId} sent signal: ${messageContent.type}`
          );
        } else {
          console.log(`Room ${roomId}: Message on topic ${packet.topic}`);
        }
      } catch (e) {
        console.log(
          `Room ${roomId}: Message on topic ${packet.topic} (could not parse)`
        );
      }
    }
  }
});

// Subscribed
aedes.on("subscribe", (subscriptions, client) => {
  if (client) {
    // Log WebRTC room subscriptions
    const webrtcSubs = subscriptions.filter((sub) =>
      sub.topic.includes("webrtc/")
    );
    if (webrtcSubs.length > 0) {
      webrtcSubs.forEach((sub) => {
        const topicParts = sub.topic.split("/");
        if (topicParts.length >= 2) {
          const roomId = topicParts[1];
          console.log(
            `Client ${client.id} subscribed to WebRTC room: ${roomId}`
          );
        }
      });
    }
  }
});

// Handle server errors
aedes.on("error", (error) => {
  console.error("MQTT Broker Error:", error.message);
});

// Handle process termination
process.on("SIGINT", function () {
  console.log("Shutting down MQTT broker...");

  // Close the aedes broker
  aedes.close(() => {
    console.log("Aedes broker closed");

    // Close HTTP server
    httpServer.close(() => {
      console.log("HTTP server closed");

      // Close HTTPS server if it exists
      if (httpsServer) {
        httpsServer.close(() => {
          console.log("HTTPS server closed");
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  });
});

console.log("MQTT Broker for WebRTC signaling is running");
console.log("-------------------------------------------");
console.log("Use the following connection URL in your WebRTC client:");
console.log(`ws://YOUR_SERVER_IP:${config.httpPort}/mqtt`);
if (config.enableHttps) {
  console.log(`or wss://YOUR_SERVER_IP:${config.httpsPort}/mqtt (secure)`);
}
if (config.enableAuth) {
  console.log(
    `Authentication is enabled (username: ${config.credentials.username})`
  );
}
