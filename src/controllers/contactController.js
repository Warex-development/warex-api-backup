const pool = require('../config/database');
const { sendContactFormAlert, sendContactFormThankYou } = require('../services/emailService');

const submitContactForm = async (req, res) => {
  try {
    const { name, email, company, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: 'All fields are required except company.' });
    }

    // 1. Save to database
    const result = await pool.query(
      `INSERT INTO contact_messages (name, email, company, subject, message) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, email, company, subject, message]
    );

    // 2. Send emails (async, don't wait for completion to respond to user)
    sendContactFormAlert({ name, email, company, subject, message });
    sendContactFormThankYou({ name, email, subject, message });

    return res.status(201).json({
      message: 'Message sent successfully! We will get back to you soon.',
      id: result.rows[0].id
    });
  } catch (error) {
    console.error('❌ [CONTACT] Error submitting contact form:', error.message);
    return res.status(500).json({ message: 'Failed to send message. Please try again later.' });
  }
};

const getAllMessages = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ [CONTACT] Error fetching messages:', error.message);
    return res.status(500).json({ message: 'Failed to fetch messages' });
  }
};

module.exports = {
  submitContactForm,
  getAllMessages
};
