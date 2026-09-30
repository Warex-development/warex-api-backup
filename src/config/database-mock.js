// Mock database connection for testing purposes while troubleshooting
const { Pool } = require('pg');

console.log('\n⚠️  Connection Status: AUTHENTICATION FAILED');
console.log('Error: "Tenant or user not found" from Supabase Session Pooler');
console.log('\nAttempting to start with mock database for API testing...\n');

// Create a mock pool that logs requests but doesn't actually connect
const mockUsers = {};

const mockPool = {
  query: async (sql, params = []) => {
    console.log('[MOCK DB]', sql.substring(0, 50) + '...');
    
    try {
      // Mock register/login queries
      if (sql.includes('INSERT INTO users')) {
        const user = {
          id: Object.keys(mockUsers).length + 1,
          full_name: params[0],
          email: params[1],
          password_hash: params[2],
          mobile: params[3],
          country: params[4],
          role: params[5] || 'member',
          company_name: params[6],
          created_at: new Date().toISOString()
        };
        mockUsers[params[1]] = user;
        return { rows: [user] };
      } else if (sql.includes('SELECT * FROM users WHERE email')) {
        const user = mockUsers[params[0]];
        return { rows: user ? [user] : [] };
      } else if (sql.includes('SELECT * FROM users WHERE id')) {
        const user = Object.values(mockUsers).find(u => u.id === params[0]);
        return { rows: user ? [user] : [] };
      } else if (sql.includes('CREATE TABLE')) {
        return { rows: [] };
      } else if (sql.includes('CREATE INDEX')) {
        return { rows: [] };
      }
      return { rows: [] };
    } catch (error) {
      throw error;
    }
  },
  end: async () => {}
};

module.exports = mockPool;
