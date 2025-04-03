require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const express = require('express');
const { parseAnswerSheetHTML } = require('./parser');
const answerKeys = require('./answerKeys');

// Initialize Express
const app = express();
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Response Schema
const responseSchema = new mongoose.Schema({
  applicationNumber: String,
  candidateName: String,
  rollNumber: String,
  testDate: String,
  testTime: String,
  responseSheetUrl: String,
  totalScore: Number,
  subjectScores: {
    physics: { correct: Number, incorrect: Number, unattempted: Number },
    chemistry: { correct: Number, incorrect: Number, unattempted: Number },
    maths: { correct: Number, incorrect: Number, unattempted: Number }
  },
  chatId: Number,
  analysisDate: { type: Date, default: Date.now }
});

const Response = mongoose.model('Response', responseSchema);

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Webhook Setup
app.post(`/webhook/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health Check
app.get('/', (req, res) => res.send('JEE Mains Bot is running!'));

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`);
});

// Bot Commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🔬 <b>JEE Mains Score Calculator</b>\n\n` +
    `📤 Send your official response sheet URL from:\n` +
    `https://jeemain.nta.ac.in\n\n` +
    `Example: https://cdn3.digialm.com/.../DL01108953_2083O24353S1D54672E2.html`,
    { parse_mode: 'HTML' }
  );
});

// Message Handler
bot.on('message', async (msg) => {
  if (!msg.text.startsWith('http')) return;

  const chatId = msg.chat.id;
  const processingMsg = await bot.sendMessage(chatId, '📥 Downloading response sheet...');

  try {
    const { data: html } = await axios.get(msg.text);
    const userData = parseAnswerSheetHTML(html);
    
    // Determine shift
    const [day, month, year] = userData.general_info.test_date.split('/');
    const shift = userData.general_info.test_time.includes('9:00') ? 'shift-1' : 'shift-2';
    const examKey = `${year}-${month}-${day}-${shift}`;
    
    // Calculate score
    const result = evaluateAnswers(userData.questions, answerKeys[examKey] || {});
    
    // Save to database
    await new Response({
      applicationNumber: userData.general_info.application_number,
      candidateName: userData.general_info.candidate_name,
      rollNumber: userData.general_info.roll_number,
      testDate: userData.general_info.test_date,
      testTime: userData.general_info.test_time,
      responseSheetUrl: msg.text,
      totalScore: result.totalScore,
      subjectScores: result.subjectStats,
      chatId: chatId
    }).save();

    // Send results
    await bot.sendMessage(chatId, formatResults(userData.general_info, result), {
      parse_mode: 'HTML'
    });

  } catch (error) {
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  } finally {
    bot.deleteMessage(chatId, processingMsg.message_id);
  }
});

function evaluateAnswers(questions, answerKey) {
  const result = {
    correctCount: 0,
    incorrectCount: 0,
    attemptedCount: 0,
    subjectStats: {
      physics: { correct: 0, incorrect: 0, unattempted: 0 },
      chemistry: { correct: 0, incorrect: 0, unattempted: 0 },
      maths: { correct: 0, incorrect: 0, unattempted: 0 }
    }
  };

  questions.forEach(q => {
    const correctAnswer = answerKey[q.question_id];
    if (!correctAnswer) return;

    if (q.given_answer !== "No Answer") {
      result.attemptedCount++;
      if (q.given_answer === correctAnswer.toString()) {
        result.correctCount++;
        result.subjectStats[q.subject].correct++;
      } else {
        result.incorrectCount++;
        result.subjectStats[q.subject].incorrect++;
      }
    } else {
      result.subjectStats[q.subject].unattempted++;
    }
  });

  result.totalScore = (result.correctCount * 4) - (result.incorrectCount * 1);
  return result;
}

function formatResults(info, result) {
  return `
📝 <b>JEE Mains Analysis</b>

👤 <b>Candidate:</b> ${info.candidate_name}
📋 <b>Application No:</b> ${info.application_number}
🔢 <b>Roll No:</b> ${info.roll_number}
📅 <b>Date:</b> ${info.test_date} (${info.test_time})

📊 <b>Performance</b>
✅ Correct: ${result.correctCount} (${result.correctCount * 4} marks)
❌ Incorrect: ${result.incorrectCount} (-${result.incorrectCount} marks)
➖ Unattempted: ${result.totalQuestions - result.attemptedCount}
🎯 <b>Estimated Score:</b> ${result.totalScore}

📚 <b>Subject-wise</b>
🧪 Physics: ${result.subjectStats.physics.correct}✔️ ${result.subjectStats.physics.incorrect}✖️
⚗️ Chemistry: ${result.subjectStats.chemistry.correct}✔️ ${result.subjectStats.chemistry.incorrect}✖️
🧮 Maths: ${result.subjectStats.maths.correct}✔️ ${result.subjectStats.maths.incorrect}✖️
  `;
  }
