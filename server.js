require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./src/config/database');
const fs = require('fs');
const path = require('path');

// Import routes
const authRoutes = require('./src/routes/auth');
const protectedRoutes = require('./src/routes/protected');
const categoryRoutes = require('./src/routes/categories');
const productRoutes = require('./src/routes/products');
const listingRoutes = require('./src/routes/listings');
const requestRoutes = require('./src/routes/requests');
const dealRoutes = require('./src/routes/deals');
const notificationRoutes = require('./src/routes/notifications');
const uploadRoutes = require('./src/routes/uploads');
const analyticsRoutes = require('./src/routes/analytics');
const membershipRoutes = require('./src/routes/membership');
const adminMembershipRoutes = require('./src/routes/adminMembership');
const statsRoutes = require('./src/routes/stats');
const leadsRoutes = require('./src/routes/leads');
const userRoutes = require('./src/routes/users');
const industriesRoutes = require('./src/routes/industries');
const contactRoutes = require('./src/routes/contact');
const brandsRoutes = require('./src/routes/brands');
const warexpediaRoutes = require('./src/routes/warexpedia');
const adminWarexpediaRoutes = require('./src/routes/adminWarexpedia');
const walletRoutes = require('./src/routes/wallet');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// In development, permit local development ports
if (process.env.NODE_ENV !== 'production') {
  const devOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
  devOrigins.forEach(o => {
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  });
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Verify Database Connection
const verifyDatabaseConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✓ Database connection verified at:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    throw error;
  }
};

// Initialize Database Schema
const initializeDatabase = async () => {
  try {
    const schemaPath = path.join(__dirname, 'src', 'config', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✓ Database schema initialized/verified successfully');
  } catch (error) {
    console.error('✗ Database initialization error:', error.message);
    throw error;
  }
};

// Seed Default Industries
const seedDefaultIndustries = async () => {
  try {
    const checkRes = await pool.query('SELECT COUNT(*) FROM industries');
    const count = parseInt(checkRes.rows[0].count, 10);
    
    if (count === 0) {
      console.log('⚡ Seeding default industries into database...');
      const defaultIndustries = [
        { name: 'Beverages', icon: '🥤', description: 'Bottling, fermentation, filtration equipment' },
        { name: 'Brewery', icon: '🍺', description: 'Brewing kettles, fermenters, cooling systems' },
        { name: 'Dairy', icon: '🐄', description: 'Pasteurizers, separators, filling machinery' },
        { name: 'Steel', icon: '⚙️', description: 'Rolling mills, furnace parts, cranes' },
        { name: 'Hydro / Power', icon: '⚡', description: 'Turbines, generators, gate actuators' },
        { name: 'Plywood', icon: '🪵', description: 'Veneer presses, sorters, stackers' },
        { name: 'Hospitality', icon: '🏨', description: 'Kitchen equipment, HVAC, laundry machinery' },
        { name: 'Construction', icon: '🏗️', description: 'Concrete mixers, excavators, cranes' },
        { name: 'Agro-Processing', icon: '🌾', description: 'Threshers, mills, seed cleaners' },
        { name: 'Printing & Packaging', icon: '📦', description: 'Printing presses, die-cutters, sealers' },
        { name: 'Chemicals & Pharma', icon: '💊', description: 'Reactors, filters, precision sensors' },
        { name: 'Logistics', icon: '📦', description: 'Conveyor systems, sorting machines, forklifts' },
        { name: 'Engineering', icon: '⚙️', description: 'Engineering equipment and parts' },
        { name: 'Consultancy', icon: '💼', description: 'Consulting and professional services' },
        { name: 'Cement', icon: '🏭', description: 'Cement manufacturing equipment' },
        { name: 'Tea', icon: '🍵', description: 'Tea processing and packaging' },
        { name: 'Animal Feed', icon: '🌾', description: 'Animal feed processing equipment' },
        { name: 'Edible Oil', icon: '🫙', description: 'Oil processing and refining' },
        { name: 'Personal Care', icon: '🧴', description: 'Personal care manufacturing' },
        { name: 'FMCG', icon: '🛒', description: 'Fast moving consumer goods' },
        { name: 'Textiles', icon: '🧵', description: 'Textile manufacturing equipment' },
        { name: 'Herbal', icon: '🌿', description: 'Herbal and natural products' },
        { name: 'Plastic', icon: '♻️', description: 'Plastic manufacturing equipment' },
        { name: 'Paper', icon: '📄', description: 'Paper and pulp industry' },
        { name: 'Automobiles', icon: '🚗', description: 'Automobile parts and equipment' },
        { name: 'Food', icon: '🍱', description: 'Food processing and packaging' },
        { name: 'Others', icon: '📋', description: 'Other industrial sectors' }
      ];

      for (const ind of defaultIndustries) {
        await pool.query(
          'INSERT INTO industries (name, icon, description) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
          [ind.name, ind.icon, ind.description]
        );
      }
      console.log('✓ Successfully seeded default industries');
    } else {
      console.log('✓ Industries database table already has data. Skipping seed.');
    }
  } catch (error) {
    console.error('✗ Failed to seed default industries:', error.message);
  }
};


// Cache official logo and favicon as Base64 so gateway page always renders assets without external dependency
let cachedLogoDataUri = '';
let cachedFaviconDataUri = '';
try {
  const logoWhitePath = path.join(__dirname, 'assets', 'logo-white.png');
  const logoDefaultPath = path.join(__dirname, 'assets', 'logo.png');
  const finalLogoPath = fs.existsSync(logoWhitePath) ? logoWhitePath : (fs.existsSync(logoDefaultPath) ? logoDefaultPath : null);
  if (finalLogoPath) {
    cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(finalLogoPath).toString('base64')}`;
  }

  const faviconPath = path.join(__dirname, 'assets', 'favicon.png');
  if (fs.existsSync(faviconPath)) {
    cachedFaviconDataUri = `data:image/png;base64,${fs.readFileSync(faviconPath).toString('base64')}`;
  }
} catch (e) {
  console.warn('Could not cache assets data URI:', e.message);
}

// Serve logo & favicon assets directly
app.get('/logo-white.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'logo-white.png'));
});
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'logo.png'));
});
app.get(['/favicon.ico', '/favicon.png'], (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'favicon.png'));
});
app.get('/favicon.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'favicon.svg'));
});

// Health Check Route
app.get('/', (req, res) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WareXhub API Gateway</title>
    <link rel="icon" type="image/png" href="${cachedFaviconDataUri || '/favicon.png'}">
    <link rel="shortcut icon" href="${cachedFaviconDataUri || '/favicon.png'}">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #4A3A5C;
            --bg: #0c0813;
            --card: #1a1329;
            --text: #f3f1f7;
            --text-secondary: #a89ec9;
            --accent: #10B981;
        }
        body {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            background-color: var(--bg);
            color: var(--text);
            font-family: 'Outfit', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            overflow: hidden;
            position: relative;
        }
        /* Background Glows */
        body::before {
            content: '';
            position: absolute;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, rgba(74, 58, 92, 0.4) 0%, transparent 70%);
            top: 10%;
            left: 10%;
            z-index: 0;
            pointer-events: none;
        }
        body::after {
            content: '';
            position: absolute;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, transparent 70%);
            bottom: 10%;
            right: 10%;
            z-index: 0;
            pointer-events: none;
        }
        .container {
            position: relative;
            z-index: 10;
            background: rgba(26, 19, 41, 0.7);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            padding: 40px;
            width: 90%;
            max-width: 430px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
            text-align: center;
        }
        .logo-container {
            margin-bottom: 24px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 48px;
        }
        .logo-img {
            height: 48px;
            width: auto;
            max-width: 260px;
            object-fit: contain;
            display: block;
        }
        .logo-text {
            font-size: 32px;
            font-weight: 800;
            letter-spacing: -1px;
            background: linear-gradient(to right, #ffffff, #a89ec9);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin: 0;
        }
        .logo-text span {
            color: #10B981;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            color: #10B981;
            padding: 6px 16px;
            border-radius: 100px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        .pulse-dot {
            width: 8px;
            height: 8px;
            background-color: #10B981;
            border-radius: 50%;
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
            animation: pulse 1.6s infinite;
        }
        @keyframes pulse {
            0% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
            }
            70% {
                transform: scale(1);
                box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
            }
            100% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
            }
        }
        h1 {
            font-size: 24px;
            margin: 0 0 8px 0;
            font-weight: 600;
            color: #ffffff;
        }
        p {
            font-size: 14px;
            color: var(--text-secondary);
            margin: 0 0 32px 0;
            line-height: 1.5;
        }
        .info-grid {
            display: grid;
            grid-template-cols: 1fr 1fr;
            gap: 16px;
            text-align: left;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 24px;
        }
        .info-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .info-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            font-weight: 600;
        }
        .info-value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            color: #ffffff;
        }
        .footer {
            margin-top: 32px;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.35);
            line-height: 1.6;
        }
        .footer a {
            color: rgba(255, 255, 255, 0.4);
            text-decoration: none;
            transition: color 0.2s, border-color 0.2s;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
            padding-bottom: 1px;
        }
        .footer a:hover {
            color: #ffffff;
            border-bottom-color: rgba(255, 255, 255, 0.6);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo-container">
            <img id="api-logo" src="${cachedLogoDataUri || '/logo-white.png'}" alt="WareXhub" class="logo-img" />
        </div>
        <div class="status-badge">
            <span class="pulse-dot"></span>
            API Gateway Operational
        </div>
        <h1>Connection Stable</h1>
        <p>The backend gateway is running and responding to queries successfully.</p>
        
        <div class="info-grid">
            <div class="info-item">
                <span class="info-label">Environment</span>
                <span class="info-value" id="env">${process.env.NODE_ENV || 'production'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Server Time</span>
                <span class="info-value" id="time">UTC</span>
            </div>
            <div class="info-item">
                <span class="info-label">DB Connection</span>
                <span class="info-value" style="color: #10B981;">Connected</span>
            </div>
            <div class="info-item">
                <span class="info-label">Gateway Ping</span>
                <span class="info-value" id="latency">-- ms</span>
            </div>
        </div>
        
        <div class="footer">
            &copy; 2026 WareXhub. All rights reserved.<br>
            Developed by <a href="https://brandnestagency.vercel.app/" target="_blank" rel="noopener noreferrer">Brandnest - India's First AI Powered Web & Digital Marketing Agency</a>
        </div>
    </div>
    <script>
        const updateTime = () => {
            const now = new Date();
            document.getElementById('time').textContent = now.toUTCString().replace('GMT', 'UTC');
        };
        updateTime();
        setInterval(updateTime, 1000);

        const start = Date.now();
        setTimeout(() => {
            document.getElementById('latency').textContent = (Date.now() - start) + ' ms';
        }, 20);
    </script>
</body>
</html>
  `);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/membership', membershipRoutes);
app.use('/api/admin/membership', adminMembershipRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/industries', industriesRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/brands', brandsRoutes);
app.use('/api/warexpedia', warexpediaRoutes);
app.use('/api/admin/warexpedia', adminWarexpediaRoutes);
app.use('/api/wallet', walletRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler (Sanitizes error output in production)
app.use((err, req, res, next) => {
  console.error('💥 [Server Error]:', err);
  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: isProd ? 'Internal server error. Please try again later.' : (err.message || 'Internal server error')
  });
});

// Start Server
const startServer = async () => {
  try {
    console.log('\n========== WareX API Starting ==========');
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Port:', PORT);
    
    // Verify database connection first
    await verifyDatabaseConnection();
    
    // Initialize database schema
    await initializeDatabase();

    // Seed default industries if empty
    await seedDefaultIndustries();
    
    app.listen(PORT, () => {
      console.log(`✓ WareX API running on port ${PORT}`);
      console.log('========== API Ready ==========\n');
    });
  } catch (error) {
    console.error('\n✗ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
