const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const helmet = require('helmet');
const { connectDB } = require('./config/database');
const { globalApiLimiter } = require('./middleware/rateLimiter');
const routes = require('./routes/index');
const mongoSanitize = require('express-mongo-sanitize');
const correlationMiddleware = require('./middleware/correlation');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  mongoSanitize({
    replaceWith: '_', 
  })
);
app.use(morgan('dev'));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(correlationMiddleware);
connectDB().catch((err) => {
  console.error('DB connect error:', err);
});
app.use(helmet());
app.use(globalApiLimiter);
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'EMPLOYIX API running smoothly',
  });
});
app.use('/v1', routes);
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});
app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

app.listen(process.env.PORT, () => {
  console.log(`EMPLOYIX server running on port ${process.env.PORT}`);
});

module.exports = app;