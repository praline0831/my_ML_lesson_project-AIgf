import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();

// Basic HTTP route
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// WebSocket endpoint
const server = app.listen(3000, () => {
  console.log('Gateway server running on http://localhost:3000');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    ws.send(`Echo: ${message}`);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});