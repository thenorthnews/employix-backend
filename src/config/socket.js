const { Server } = require('socket.io');

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // Allow frontend dev & prod origins
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join room dedicated to a specific user/candidate
    socket.on('join_user_room', (userId) => {
      if (userId) {
        const room = `user_${userId}`;
        socket.join(room);
        console.log(`[Socket.io] Socket ${socket.id} joined ${room}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    console.warn('[Socket.io] IO not initialized yet');
  }
  return io;
};

/**
 * Emit an event to a specific user's room and broadcast to active frontend listeners
 * @param {string} userId - Target candidate user ID
 * @param {string} eventName - Socket event name (e.g. 'reference_verified')
 * @param {object} payload - Event data
 */
const emitToUser = (userId, eventName, payload = {}) => {
  if (!io) {
    console.warn('[Socket.io] Cannot emit, io is not initialized');
    return;
  }

  const data = {
    ...payload,
    targetUserId: userId ? String(userId) : null,
    timestamp: new Date().toISOString(),
  };

  if (userId) {
    io.to(`user_${userId}`).emit(eventName, data);
    console.log(`[Socket.io] Emitted '${eventName}' to room user_${userId}`);
  }

  // Also broadcast so any active tab for this user receives it reliably
  io.emit(eventName, data);
};

module.exports = {
  initSocket,
  getIO,
  emitToUser,
};
