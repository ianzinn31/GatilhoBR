#!/usr/bin/env node
/*
 * GatilhoBR Native Messaging host (diagnostic relay)
 *
 * Chrome frames each message as: uint32 little-endian byte length + UTF-8 JSON.
 * This host deliberately performs no betting actions and has no network access;
 * it simply acknowledges/echoes messages so the extension/dashboard bridge can
 * be validated before wiring a production transport.
 */
'use strict';

const fs = require('fs');
const net = require('net');

const PIPE_NAME = '\\\\.\\pipe\\gatilhobr-native-bridge';

const MAX_MESSAGE_BYTES = 1024 * 1024; // protect the host from malformed input
let input = Buffer.alloc(0);

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

let pipe = null;
let connectingPipe = null;
let reconnectTimer = null;
let shuttingDown = false;
const pendingPipeMessages = [];
const MAX_PENDING_PIPE_MESSAGES = 200;
const RECONNECT_DELAY_MS = 1000;

function writeMessage(value) {
  const data = frame(value);
  // stdout is the Native Messaging response channel. Messages arriving from
  // Electron are forwarded below as raw framed bytes for the same reason.
  process.stdout.write(data);
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer || (pipe && !pipe.destroyed) || connectingPipe) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPipe();
  }, RECONNECT_DELAY_MS);
}

function sendToPipe(value) {
  const data = frame(value);
  if (!pipe || pipe.destroyed) {
    // The Electron app may still be starting. Keep a small bounded backlog so
    // the first market update is not silently lost during that race.
    if (pendingPipeMessages.length >= MAX_PENDING_PIPE_MESSAGES) pendingPipeMessages.shift();
    pendingPipeMessages.push(data);
    scheduleReconnect();
    return false;
  }

  try {
    pipe.write(data);
    return true;
  } catch (_) {
    if (pendingPipeMessages.length >= MAX_PENDING_PIPE_MESSAGES) pendingPipeMessages.shift();
    pendingPipeMessages.push(data);
    scheduleReconnect();
    return false;
  }
}

function flushPendingPipeMessages() {
  while (pipe && !pipe.destroyed && pendingPipeMessages.length) {
    try {
      pipe.write(pendingPipeMessages.shift());
    } catch (_) {
      scheduleReconnect();
      return;
    }
  }
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    writeMessage({ ok: false, type: 'error', error: 'invalid_json' });
    return;
  }

  // Encaminha o evento recebido da extensão para o processo principal. O
  // envelope explícito evita que ACKs/diagnóstico sejam confundidos com dados
  // de mercado pelo agregador do GatilhoBR.
  sendToPipe({ direction: 'from-extension', message });
}

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (length > MAX_MESSAGE_BYTES) {
      writeMessage({ ok: false, type: 'error', error: 'message_too_large' });
      process.exit(1);
    }
    if (input.length < 4 + length) return;
    const body = input.subarray(4, 4 + length);
    input = input.subarray(4 + length);
    handleMessage(body);
  }
});

// Pipe replies are already framed JSON; forward bytes unchanged.
function connectPipe() {
  if (shuttingDown || (pipe && !pipe.destroyed) || connectingPipe) return;
  const socket = net.createConnection(PIPE_NAME);
  connectingPipe = socket;
  const clearCurrentSocket = () => {
    if (connectingPipe === socket) connectingPipe = null;
    if (pipe === socket) pipe = null;
  };
  socket.on('connect', () => {
    if (shuttingDown) {
      socket.destroy();
      return;
    }
    connectingPipe = null;
    pipe = socket;
    flushPendingPipeMessages();
  });
  socket.on('data', (chunk) => process.stdout.write(chunk));
  socket.on('error', () => {
    clearCurrentSocket();
    scheduleReconnect();
  });
  socket.on('close', () => {
    clearCurrentSocket();
    scheduleReconnect();
  });
}
connectPipe();

function shutdown() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (connectingPipe && !connectingPipe.destroyed) connectingPipe.destroy();
  if (pipe && !pipe.destroyed) pipe.destroy();
}

process.stdin.on('end', () => {
  shutdown();
  process.exit(0);
});
process.stdin.on('error', (error) => {
  shutdown();
  fs.writeSync(2, `native host stdin error: ${error.message}\n`);
  process.exit(1);
});
