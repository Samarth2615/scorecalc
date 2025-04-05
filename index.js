require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const express = require('express');
const cheerio = require('cheerio');
const answerKeys = require('./answerKeys');

// Initialize Express app
const app = express();
app.use(express.json());

// Connect to MongoDB with error handling
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};
connectDB();

// Response Schema with validation
const responseSchema = new mongoose.Schema({
  applicationNumber: { type: String, required: true },
  candidateName: { type: String, required: true },
  rollNumber: { type: String, required: true, index: true },
  testDate: { type: String, required: true },
  testTime: { type: String, required: true },
  responseSheetUrl: { type: String, required: true },
  totalScore: { type: Number, required: true },
  subjectScores: {
    physics: {
      correct: { type: Number, default: 0 },
      incorrect: { type: Number, default: 0 },
      unattempted: { type: Number, default: 0 },
      dropped: { type: Number, default: 0 }
    },
    chemistry: {
      correct: { type: Number, default: 0 },
      incorrect: { type: Number, default: 0 },
      unattempted: { type: Number, default: 0 },
      dropped: { type: Number, default: 0 }
    },
    maths: {
      correct: { type: Number, default: 0 },
      incorrect: { type: Number, default: 0 },
      unattempted: { type: Number, default: 0 },
      dropped: { type: Number, default: 0 }
    }
  },
  chatId: { type: Number, required: true, index: true },
  analysisDate: { type: Date, default: Date.now }
});

const Response = mongoose.model('Response', responseSchema);

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Webhook endpoint
app.post(`/webhook/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check endpoint
app.get('/', (req, res) => res.send('JEE Mains Bot Service is Running'));

// Admin authentication middleware
const basicAuth = (req, res, next) => {
  const auth = { login: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  
  if (login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Authentication required');
};

// Admin dashboard route
app.get('/admin', basicAuth, async (req, res) => {
  try {
    const responses = await Response.find().sort({ analysisDate: -1 }).limit(50);
    
    let html = `<!DOCTYPE html><html><head>
      <title>JEE Bot Admin</title>
      <style>
        table { width:100%; border-collapse:collapse; margin-top:20px }
        th, td { padding:8px; text-align:left; border:1px solid #ddd }
        th { background:#f2f2f2 }
        tr:nth-child(even) { background:#f9f9f9 }
        .progress { background:#e0e0e0; height:20px; border-radius:4px }
        .progress-bar { background:#4CAF50; height:100%; border-radius:4px }
      </style></head><body>
      <h1>JEE Mains Response Data (Last 50)</h1>
      <table><tr>
        <th>Roll No</th><th>Name</th><th>Date</th>
        <th>Score</th><th>Physics</th><th>Chemistry</th>
        <th>Maths</th><th>Actions</th>
      </tr>`;

    responses.forEach(r => {
      const progressBar = (correct) => {
        const percentage = Math.min(Math.round((correct / 25) * 100), 100);
        return `<div class="progress">
          <div class="progress-bar" style="width:${percentage}%">${correct}</div>
        </div>`;
      };
      
      html += `<tr>
        <td>${r.applicationNumber}</td>
        <td>${r.rollNumber}</td>
        <td>${r.candidateName}</td>
        <td>${r.testDate} (${r.testTime})</td>
        <td><b>${r.totalScore}</b>/300</td>
        <td>${progressBar(r.subjectScores.physics.correct)}</td>
        <td>${progressBar(r.subjectScores.chemistry.correct)}</td>
        <td>${progressBar(r.subjectScores.maths.correct)}</td>
        <td><a href="/admin/response/${r._id}">View</a></td>
      </tr>`;
    });

    html += `</table>
      <p><a href="/admin/export">Export as CSV</a></p>
      <form action="/admin/search" method="get">
        <input type="text" name="query" placeholder="Roll No or Name">
        <button type="submit">Search</button>
      </form></body></html>`;

    res.send(html);
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).send('Server error');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`);
});

// Bot command handlers
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🔬 <b>JEE Mains Score Calculator for session 1</b>\n\n` +
    `📤 Send your official response sheet URL from:\n` +
    `https://jeemain.nta.ac.in\n\n` +
    `Example: https://cdn3.digialm.com/...2083O243S1D54692E2.html`,
    { parse_mode: 'HTML' }
  );
});

// Message handler with proper error handling
bot.on('message', async (msg) => {
  if (!msg.text.startsWith('http')) return;

  const chatId = msg.chat.id;
  let processingMsg;

  try {
    processingMsg = await bot.sendMessage(chatId, '📥 Downloading response sheet...');
    
    // Fetch response sheet with timeout
    const { data: html } = await axios.get(msg.text, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!html.includes('question-pnl')) {
      throw new Error('Invalid response sheet format');
    }

    await bot.editMessageText('🔍 Analyzing your responses...', {
      chat_id: chatId,
      message_id: processingMsg.message_id
    });

    // Parse and evaluate responses
    const userData = parseAnswerSheetHTML(html);
    const [day, month, year] = userData.general_info.test_date.split('/');
    const shift = userData.general_info.test_time.includes('9:00') ? 'shift-1' : 'shift-2';
    const examKey = `${year}-${month}-${day}-${shift}`;
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
    console.error('Error processing message:', error);
    const errorMsg = error.response ? 'Invalid URL or server error' : error.message;
    await bot.sendMessage(chatId, `❌ Error: ${errorMsg}`);
  } finally {
    if (processingMsg) {
      bot.deleteMessage(chatId, processingMsg.message_id).catch(console.error);
    }
  }
});

// Helper functions
function parseAnswerSheetHTML(html) {
  const $ = cheerio.load(html);
  const generalInfo = {};
  const questions = [];

  // Parse general info
  $('table[style*="width:500px"] tr').each((i, row) => {
    const cols = $(row).find('td');
    if (cols.length >= 2) {
      const label = $(cols[0]).text().trim().toLowerCase();
      const value = $(cols[1]).text().trim();
      if (label.includes('application')) generalInfo.application_number = value;
      else if (label.includes('name')) generalInfo.candidate_name = value;
      else if (label.includes('roll')) generalInfo.roll_number = value;
      else if (label.includes('date')) generalInfo.test_date = value;
      else if (label.includes('time')) generalInfo.test_time = value;
    }
  });

  // Parse questions
  $('.question-pnl').each((i, panel) => {
    const panel$ = $(panel);
    const questionId = panel$.find('td:contains("Question ID") + td').text().trim();
    const questionType = panel$.find('td:contains("Question Type") + td').text().trim();
    let givenAnswer = "No Answer";

    if (questionType === "MCQ") {
      const selectedOption = panel$.find('td:contains("Chosen Option") + td').text().trim();
      if (selectedOption) {
        givenAnswer = panel$.find(`td:contains("Option ${selectedOption}") + td`).text().trim();
      }
    } else if (questionType === "SA") {
      givenAnswer = panel$.find('td.bold[style*="word-break"]').text().trim();
    }

    const section = panel$.closest('.section-cntnr').find('.section-lbl').text();
    let subject = "unknown";
    if (section.includes("Physics")) subject = "physics";
    else if (section.includes("Chemistry")) subject = "chemistry";
    else if (section.includes("Mathematics")) subject = "maths";

    if (questionId) {
      questions.push({
        question_id: questionId,
        given_answer: givenAnswer,
        subject: subject,
        type: questionType
      });
    }
  });

  return { general_info: generalInfo, questions };
}

function evaluateAnswers(userAnswers, answerKey) {
  const result = {
    correctCount: 0,
    incorrectCount: 0,
    droppedCount: 0,
    attemptedCount: 0,
    subjectStats: {
      physics: { correct: 0, incorrect: 0, unattempted: 0, dropped: 0 },
      chemistry: { correct: 0, incorrect: 0, unattempted: 0, dropped: 0 },
      maths: { correct: 0, incorrect: 0, unattempted: 0, dropped: 0 }
    },
    totalScore: 0,
    totalQuestions: Object.keys(answerKey).length
  };

  Object.entries(answerKey).forEach(([questionId, correctAnswerId]) => {
    const userAnswer = userAnswers.find(q => q.question_id === questionId);
    const subject = userAnswer?.subject?.toLowerCase() || "unknown";

    if (!result.subjectStats[subject]) {
      result.subjectStats[subject] = { correct: 0, incorrect: 0, unattempted: 0, dropped: 0 };
    }

    if (correctAnswerId === "Drop") {
      result.droppedCount++;
      result.subjectStats[subject].dropped++;
    } else if (userAnswer?.given_answer && userAnswer.given_answer !== "No Answer") {
      result.attemptedCount++;

      const isCorrect = correctAnswerId.includes(",") 
        ? correctAnswerId.split(",").includes(userAnswer.given_answer)
        : userAnswer.given_answer === correctAnswerId;

      if (isCorrect) {
        result.correctCount++;
        result.subjectStats[subject].correct++;
      } else {
        result.incorrectCount++;
        result.subjectStats[subject].incorrect++;
      }
    } else {
      result.subjectStats[subject].unattempted++; // Not counted as incorrect
    }
  });

  // Corrected scoring (no penalty for unattempted)
  result.totalScore = (result.correctCount * 4) - (result.incorrectCount * 1) + (result.droppedCount * 4);
  
  return result;
}

function formatResults(info, result) {
  const unattemptedCount = result.totalQuestions - result.attemptedCount - result.droppedCount;
  const totalPerSubject = result.totalQuestions / 3;

  const subjectStats = (subject) => {
    const stats = result.subjectStats[subject];
    const percentage = Math.round((stats.correct / totalPerSubject) * 100);
    const progress = '▓'.repeat(Math.round(percentage / 5)) + '░'.repeat(20 - Math.round(percentage / 5));
    
    return `
    <b>${subject.charAt(0).toUpperCase() + subject.slice(1)} (${stats.correct}/${totalPerSubject})</b>
    ${progress} ${percentage}%
    ✅ ${stats.correct} | ❌ ${stats.incorrect} | ➖ ${stats.unattempted} | ✖️ ${stats.dropped}
    `;
  };

  return `
<b>📝 JEE Mains Response Analysis</b>

<b>📋 Application No:</b> <code>${escapeHtml(info.application_number || "N/A")}</code>
<b>👤 Candidate:</b> <code>${escapeHtml(info.candidate_name)}</code>
<b>🔢 Roll No:</b> <code>${escapeHtml(info.roll_number)}</code>
<b>📅 Exam Date:</b> <code>${escapeHtml(info.test_date)}</code>
<b>⏰ Shift:</b> <code>${escapeHtml(info.test_time)}</code>

<b>📊 Overall Performance</b>
✅ <b>Correct:</b> ${result.correctCount} (➕${result.correctCount * 4} marks)
❌ <b>Incorrect:</b> ${result.incorrectCount} (➖${result.incorrectCount * 1} marks)
➖ <b>Unattempted:</b> ${unattemptedCount} (0 marks)
✖️ <b>Dropped:</b> ${result.droppedCount} (➕${result.droppedCount * 4} marks)
📝 <b>Attempted:</b> ${result.attemptedCount}/${result.totalQuestions}

🎖️ <b>Estimated Score:</b> <code>${result.totalScore}/300</code>

<b>📚 Subject-wise Analysis</b>
${subjectStats('physics')}
${subjectStats('chemistry')}
${subjectStats('maths')}

<i>🔹 Marking Scheme: +4 (correct), -1 (wrong), 0 (unattempted), +4 (dropped)</i>
`;
}

function escapeHtml(text) {
  if (!text) return "";
  return text.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
    }
