require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { parseAnswerSheetHTML } = require('./parser');
const answerKeys = require('./answerKey.json');

// Initialize bot
const token = process.env.TELEGRAM_BOT_TOKEN || '7450159955:AAFB8W8frCScGJfi2ygYJT9qcuTqWL19Gts';
const bot = new TelegramBot(token, { polling: true });

// Store user sessions
const userSessions = {};

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `📊 *JEE Mains Score Calculator* 📊\n\n` +
    `Send me your response sheet URL from:\n` +
    `https://jeemain.nta.ac.in\n\n` +
    `I'll calculate your estimated score!`,
    { parse_mode: 'Markdown' }
  );
});

// Handle response sheet URLs
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.match(/https?:\/\/[^\s]+/)) {
    try {
      await bot.sendChatAction(chatId, 'typing');
      const processingMsg = await bot.sendMessage(chatId, '🔍 Processing your response sheet...');

      // Fetch HTML content
      const response = await axios.get(text);
      const htmlContent = response.data;

      // Parse response sheet
      const userAnswers = parseAnswerSheetHTML(htmlContent);
      
      // Extract exam details
      const extractedDate = userAnswers.general_info.test_date;
      const extractedTime = userAnswers.general_info.test_time;
      const [day, month, year] = extractedDate.split('/');
      const normalizedDate = `${year}-${month}-${day}`;
      const shift = extractedTime.includes('9:00 AM') ? 'shift-1' : 'shift-2';
      const examDateKey = `${normalizedDate}-${shift}`;

      // Find matching answer key
      const answerKey = answerKeys[examDateKey];
      if (!answerKey) {
        await bot.editMessageText('❌ No answer key found for your exam shift!', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        return;
      }

      // Calculate score
      const result = evaluateAnswers(userAnswers.questions, answerKey);

      // Format response
      const responseMsg = formatResults(userAnswers.general_info, result);
      
      await bot.editMessageText(responseMsg, {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, '❌ Error processing your response sheet. Please check the URL and try again.');
    }
  }
});

// Score calculation function
function evaluateAnswers(userAnswers, answerKey) {
  let correctCount = 0, incorrectCount = 0, attemptedCount = 0, droppedCount = 0;
  
  const subjectStats = {
    physics: { attempted: 0, correct: 0, incorrect: 0, dropped: 0 },
    chemistry: { attempted: 0, correct: 0, incorrect: 0, dropped: 0 },
    maths: { attempted: 0, correct: 0, incorrect: 0, dropped: 0 }
  };

  for (const [questionId, correctAnswerId] of Object.entries(answerKey)) {
    const userAnswer = userAnswers.find(q => q.question_id === questionId);
    const userAnswerId = userAnswer?.given_answer || "No Answer";
    const subject = userAnswer?.subject || "unknown";

    if (correctAnswerId === "Drop") {
      droppedCount++;
      if (subjectStats[subject]) subjectStats[subject].dropped++;
    } 
    else if (userAnswerId !== "No Answer") {
      attemptedCount++;
      if (subjectStats[subject]) subjectStats[subject].attempted++;

      const correctAnswers = correctAnswerId.includes(",") ? 
        correctAnswerId.split(",") : [correctAnswerId];
      
      if (correctAnswers.includes(userAnswerId)) {
        correctCount++;
        if (subjectStats[subject]) subjectStats[subject].correct++;
      } else {
        incorrectCount++;
        if (subjectStats[subject]) subjectStats[subject].incorrect++;
      }
    }
  }

  const totalScore = (correctCount * 4) - (incorrectCount * 1) + (droppedCount * 4);

  return {
    correctCount,
    incorrectCount,
    attemptedCount,
    droppedCount,
    totalScore,
    subjectStats
  };
}

// Format results message
function formatResults(generalInfo, result) {
  return `
📝 *Response Sheet Analyzed* 📝

*Candidate:* ${generalInfo.candidate_name}
*Roll No:* ${generalInfo.roll_number}
*Exam Date:* ${generalInfo.test_date}
*Shift:* ${generalInfo.test_time}

📊 *Score Summary*
✅ Correct: ${result.correctCount} (${result.correctCount * 4} marks)
❌ Incorrect: ${result.incorrectCount} (${result.incorrectCount * -1} marks)
📤 Attempted: ${result.attemptedCount}
➖ Dropped: ${result.droppedCount}

🔢 *Estimated Score:* *${result.totalScore}*

📚 *Subject-wise Analysis*
🧪 Physics: 
   ✔️ ${result.subjectStats.physics.correct} | ✖️ ${result.subjectStats.physics.incorrect}
⚗️ Chemistry: 
   ✔️ ${result.subjectStats.chemistry.correct} | ✖️ ${result.subjectStats.chemistry.incorrect}
🧮 Maths: 
   ✔️ ${result.subjectStats.maths.correct} | ✖️ ${result.subjectStats.maths.incorrect}

*Disclaimer:* This is an estimate based on available answer keys. Official results may vary.
`;
}

console.log('Bot is running...');
