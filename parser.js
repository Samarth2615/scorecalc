const cheerio = require('cheerio');

function parseAnswerSheetHTML(html) {
  const $ = cheerio.load(html);
  const generalInfo = {};
  const questions = [];

  // Extract general info
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

  // Extract questions
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
        subject: subject
      });
    }
  });

  return { general_info: generalInfo, questions };
}

module.exports = { parseAnswerSheetHTML };
