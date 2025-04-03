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
    physics: { correct: Number, incorrect: Number, unattempted: Number, dropped: Number },
    chemistry: { correct: Number, incorrect: Number, unattempted: Number, dropped: Number },
    maths: { correct: Number, incorrect: Number, unattempted: Number, dropped: Number }
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

// ADMIN DASHBOARD (Basic Auth)
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

// Admin Dashboard
app.get('/admin', basicAuth, async (req, res) => {
  try {
    const responses = await Response.find().sort({ analysisDate: -1 }).limit(50);
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>JEE Bot Admin</title>
      <style>
        table { width:100%; border-collapse:collapse; margin-top:20px }
        th, td { padding:8px; text-align:left; border:1px solid #ddd }
        th { background:#f2f2f2 }
        tr:nth-child(even) { background:#f9f9f9 }
        .progress { background:#e0e0e0; height:20px; border-radius:4px }
        .progress-bar { background:#4CAF50; height:100%; border-radius:4px }
      </style>
    </head>
    <body>
      <h1>JEE Mains Response Data (Last 50)</h1>
      <table>
        <tr>
          <th>Roll No</th>
          <th>Name</th>
          <th>Date</th>
          <th>Score</th>
          <th>Physics</th>
          <th>Chemistry</th>
          <th>Maths</th>
          <th>Actions</th>
        </tr>
    `;

    responses.forEach(r => {
      const progress = (subject) => `
        <div class="progress">
          <div class="progress-bar" style="width:${Math.round((r.subjectScores[subject].correct / 25) * 100}%">
            ${r.subjectScores[subject].correct}
          </div>
        </div>
      `;
      
      html += `
        <tr>
          <td>${r.rollNumber}</td>
          <td>${r.candidateName}</td>
          <td>${r.testDate} (${r.testTime})</td>
          <td><b>${r.totalScore}</b>/300</td>
          <td>${progress('physics')}</td>
          <td>${progress('chemistry')}</td>
          <td>${progress('maths')}</td>
          <td><a href="/admin/response/${r._id}">View</a></td>
        </tr>
      `;
    });

    html += `
      </table>
      <p><a href="/admin/export">Export as CSV</a></p>
      <form action="/admin/search" method="get">
        <input type="text" name="query" placeholder="Roll No or Name">
        <button type="submit">Search</button>
      </form>
    </body>
    </html>
    `;

    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// View Single Response
app.get('/admin/response/:id', basicAuth, async (req, res) => {
  try {
    const response = await Response.findById(req.params.id);
    if (!response) return res.status(404).send('Not found');
    
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search Responses
app.get('/admin/search', basicAuth, async (req, res) => {
  const { query } = req.query;
  try {
    const responses = await Response.find({
      $or: [
        { rollNumber: new RegExp(query, 'i') },
        { candidateName: new RegExp(query, 'i') }
      ]
    }).limit(50);
    
    res.json(responses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export Data
app.get('/admin/export', basicAuth, async (req, res) => {
  try {
    const responses = await Response.find().sort({ analysisDate: -1 });
    
    let csv = 'Roll No,Name,Date,Time,Score,Physics Correct,Physics Wrong,Chemistry Correct,Chemistry Wrong,Maths Correct,Maths Wrong\n';
    
    responses.forEach(r => {
      csv += `"${r.rollNumber}","${r.candidateName}","${r.testDate}","${r.testTime}",${r.totalScore},` +
             `${r.subjectScores.physics.correct},${r.subjectScores.physics.incorrect},` +
             `${r.subjectScores.chemistry.correct},${r.subjectScores.chemistry.incorrect},` +
             `${r.subjectScores.maths.correct},${r.subjectScores.maths.incorrect}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('jee-results.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

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

// Accurate JEE Mains Evaluation
function evaluateAnswers(userAnswers, answerKey) {
  const results = [];
  let correctCount = 0, incorrectCount = 0, attemptedCount = 0, droppedCount = 0;

  const subjectStats = {
    physics: { attempted: 0, correct: 0, incorrect: 0, dropped: 0 },
    chemistry: { attempted: 0, correct: 0, incorrect: 0, dropped: 0 },
    maths: { attempted: 0, correct: 0, incorrect: 0, dropped: 0 }
  };

  for (const [questionId, correctAnswerId] of Object.entries(answerKey)) {
    const userAnswerDetails = userAnswers.find(q => q.question_id === questionId);
    const userAnswerId = userAnswerDetails?.given_answer || "No Answer";
    const subject = userAnswerDetails?.subject?.toLowerCase() || "unknown";

    if (!subjectStats[subject]) {
      subjectStats[subject] = { attempted: 0, correct: 0, incorrect: 0, dropped: 0 };
    }

    if (correctAnswerId === "Drop") {
      droppedCount++;
      subjectStats[subject].dropped++;
    } else if (userAnswerId !== "No Answer") {
      attemptedCount++;
      subjectStats[subject].attempted++;

      const correctAnswers = correctAnswerId.includes(",") ? correctAnswerId.split(",") : [correctAnswerId];
      if (correctAnswers.includes(userAnswerId)) {
        correctCount++;
        subjectStats[subject].correct++;
      } else {
        incorrectCount++;
        subjectStats[subject].incorrect++;
      }
    }
  }

  const totalScore = (correctCount * 4) - (incorrectCount * 1) + (droppedCount * 4);

  return {
    correctCount,
    incorrectCount,
    droppedCount,
    attemptedCount,
    totalQuestions: Object.keys(answerKey).length,
    totalScore,
    subjectStats
  };
}

// Format Results with HTML
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
    ✔️ ${stats.correct} | ✖️ ${stats.incorrect} | ➖ ${stats.unattempted} | ✖️ ${stats.dropped}
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

🎯 <b>Estimated Score:</b> <code>${result.totalScore}/300</code>

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
