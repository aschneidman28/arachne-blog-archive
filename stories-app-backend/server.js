const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: '*', // More permissive for testing
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true
}));
app.use(express.json());

// Add a pre-flight handler
app.options('*', cors());

// Database connection
const pool = new Pool({
 connectionString: process.env.DATABASE_URL,
 ssl: {
   rejectUnauthorized: false
 }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
 if (err) {
   console.error('Error connecting to the database:', err);
 } else {
   console.log('Database connected successfully');
 }
});

// Cloudinary configuration
cloudinary.config({
 cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
 api_key: process.env.CLOUDINARY_API_KEY,
 api_secret: process.env.CLOUDINARY_API_SECRET
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
 try {
   const authHeader = req.headers['authorization'];
   const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

   if (!token) {
     return res.status(401).json({ error: 'No token provided' });
   }

   const decoded = jwt.verify(token, process.env.JWT_SECRET);
   req.userId = decoded.userId;
   next();
 } catch (error) {
   return res.status(403).json({ error: 'Invalid token' });
 }
};

// Basic health check endpoint
app.get('/', async (req, res) => {
 try {
   await pool.query('SELECT NOW()');
   res.json({ 
     status: 'alive',
     database: 'connected'
   });
 } catch (error) {
   res.status(500).json({ 
     status: 'alive',
     database: 'error',
     error: error.message
   });
 }
});

// Auth endpoints
app.post('/auth/signup', async (req, res) => {
 try {
   const { username, password } = req.body;
   
   const userExists = await pool.query(
     'SELECT * FROM users WHERE username = $1',
     [username]
   );

   if (userExists.rows.length > 0) {
     return res.status(400).json({ error: 'Username already exists' });
   }

   const saltRounds = 10;
   const passwordHash = await bcrypt.hash(password, saltRounds);

   const result = await pool.query(
     'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
     [username, passwordHash]
   );

   const token = jwt.sign(
     { userId: result.rows[0].id },
     process.env.JWT_SECRET,
     { expiresIn: '24h' }
   );

   res.json({
     message: 'User created successfully',
     user: {
       id: result.rows[0].id,
       username: result.rows[0].username
     },
     token
   });
 } catch (error) {
   console.error('Signup error:', error);
   res.status(500).json({ error: 'Error creating user' });
 }
});

app.post('/auth/login', async (req, res) => {
  try {
    console.log('Login attempt with:', req.body);  // Add this
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      console.log('No user found with username:', username);  // Add this
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    console.log('User found:', { id: user.id, username: user.username });  // Add this
    
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      console.log('Invalid password for user:', username);  // Add this
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        username: user.username
      },
      token
    });
  } catch (error) {
    console.error('Detailed login error:', error);  // Enhance this
    res.status(500).json({ 
      error: 'Error logging in',
      details: error.message  // Add this for debugging
    });
  }
});

// Story endpoints
app.post('/stories', authenticateToken, upload.single('image'), async (req, res) => {
 try {
   if (!req.file) {
     return res.status(400).json({ error: 'No image file provided' });
   }

   // Convert buffer to base64
   const b64 = Buffer.from(req.file.buffer).toString('base64');
   const dataURI = 'data:' + req.file.mimetype + ';base64,' + b64;
   
   // Upload to Cloudinary
   const uploadResponse = await cloudinary.uploader.upload(dataURI, {
     resource_type: 'auto',
     folder: 'stories',
   });

   const userId = req.userId;
   const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

   // Save story with Cloudinary URL
   const result = await pool.query(
     'INSERT INTO stories (user_id, image_url, expires_at) VALUES ($1, $2, $3) RETURNING *',
     [userId, uploadResponse.secure_url, expiresAt]
   );

   res.json({
     message: 'Story created successfully',
     story: result.rows[0]
   });
 } catch (error) {
   console.error('Story creation error:', error);
   res.status(500).json({ error: 'Error creating story' });
 }
});

app.get('/stories', authenticateToken, async (req, res) => {
 try {
   const result = await pool.query(
     `SELECT s.*, u.username 
      FROM stories s 
      JOIN users u ON s.user_id = u.id 
      WHERE s.expires_at > NOW() 
      ORDER BY s.created_at DESC`
   );

   res.json({
     stories: result.rows
   });
 } catch (error) {
   console.error('Error fetching stories:', error);
   res.status(500).json({ error: 'Error fetching stories' });
 }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
 console.log(`Server running on port ${PORT}`);
});