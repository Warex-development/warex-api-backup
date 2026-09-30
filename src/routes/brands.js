const express = require('express');
const router = express.Router();
const { getBrands } = require('../controllers/brandsController');

router.get('/', getBrands);

module.exports = router;
