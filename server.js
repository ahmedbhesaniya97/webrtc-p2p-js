// server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Keep track of connected clients
const clients = new Map();
let clientIdCounter = 0;

// WebSocket connection handling
wss.on('connection', (ws) => {
  const clientId = clientIdCounter++;
  clients.set(ws, { id: clientId });
  
  console.log(`Client ${clientId} connected. Total clients: ${clients.size}`);

  // Send the client their ID
  ws.send(JSON.stringify({
    type: 'id',
    id: clientId
  }));

  // Send list of connected peers
  const peerIds = Array.from(clients.values())
    .map(client => client.id)
    .filter(id => id !== clientId);
  
  ws.send(JSON.stringify({
    type: 'peers',
    peerIds
  }));

  // Inform other clients about new peer
  clients.forEach((client, clientWs) => {
    if (clientWs !== ws) {
      clientWs.send(JSON.stringify({
        type: 'new-peer',
        peerId: clientId
      }));
    }
  });

  // Message handling
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Message from client ${clientId}:`, data.type);
      
      // Handle signaling messages (forward to the appropriate peer)
      if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
        const targetId = data.target;
        const targetClient = Array.from(clients.entries())
          .find(([_, client]) => client.id === targetId);
        
        if (targetClient) {
          const [targetWs] = targetClient;
          data.from = clientId;
          targetWs.send(JSON.stringify(data));
        }
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    const disconnectedClientId = clients.get(ws).id;
    clients.delete(ws);
    
    console.log(`Client ${disconnectedClientId} disconnected. Total clients: ${clients.size}`);
    
    // Inform remaining clients about the disconnection
    clients.forEach((client, clientWs) => {
      clientWs.send(JSON.stringify({
        type: 'peer-disconnected',
        peerId: disconnectedClientId
      }));
    });
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});