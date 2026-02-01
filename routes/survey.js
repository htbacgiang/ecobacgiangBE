const express = require('express');
const router = express.Router();
const db = require('../config/database');
const SurveyResponse = require('../models/SurveyResponse');

// POST /api/survey - Submit survey response
router.post('/', async (req, res) => {
  try {
    await db.connectDb();
    const formData = req.body;

    // Validate required fields
    const requiredFields = ['q1', 'q2', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12', 'q13', 'q14', 'q15', 'q16', 'q17', 'q18', 'q19', 'q22', 'q23', 'q24'];
    for (let field of requiredFields) {
      if (!formData[field]) {
        return res.status(400).json({ message: `Vui lòng trả lời câu hỏi bắt buộc: ${field}` });
      }
    }

    // Validate rating fields (1-5)
    const ratingFields = ['q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q13', 'q14', 'q15', 'q16', 'q17', 'q18', 'q19'];
    for (let field of ratingFields) {
      const value = parseInt(formData[field]);
      if (isNaN(value) || value < 1 || value > 5) {
        return res.status(400).json({ message: `Điểm số cho ${field} phải từ 1 đến 5` });
      }
    }

    // Save to MongoDB
    const surveyResponse = new SurveyResponse({
      ...formData,
      createdAt: new Date(),
    });
    await surveyResponse.save();

    return res.status(200).json({
      status: 'success',
      message: 'Survey submitted successfully',
    });
  } catch (error) {
    console.error('Error submitting survey:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

