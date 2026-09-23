require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Role = require('../src/models/role');
const Admin = require('../src/models/admin');
const bcrypt = require('bcryptjs');

async function run() {
  await connectDB();

  const roles = [
    { name: 'admin', permissions: ['*'], description: 'Full access' },
    { name: 'user', permissions: [], description: 'Regular user' }
  ];

  for (const r of roles) {
    const existing = await Role.findOne({ name: r.name });
    if (!existing) await Role.create(r);
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@employix.local';
  const adminKey = process.env.SEED_ADMIN_STATIC_KEY || 'static-admin-key';
  const adminExists = await Admin.findOne({ email: adminEmail });
  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!', salt);
    const adminRole = await Role.findOne({ name: 'admin' });
    await Admin.create({
      name: 'Administrator',
      email: adminEmail,
      password: hash,
      staticKey: adminKey,
      role: adminRole ? adminRole._id : undefined
    });
    console.log('Admin user created:', adminEmail);
  } else {
    console.log('Admin already exists:', adminEmail);
  }

  console.log('Seeding complete');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
