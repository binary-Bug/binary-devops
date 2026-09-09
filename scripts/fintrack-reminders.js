const fs = require('fs');

async function run() {
  const PANTRY_URL = process.env.PANTRY_BASKET_URL;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  let dispatchStatus = 'Skipped - No dues found';
  let dueToday = [];
  let upcoming = [];
  let overdue = [];
  let dayOfWeek = '';
  let todayStr = '';
  let runTimeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // Helper to write to Github Step Summary
  const writeSummary = () => {
    let md = `## 🔔 Fintrack Pro Reminders Run Report\n\n`;
    md += `**Run Time (IST):** ${runTimeStr}\n`;
    md += `**Telegram Dispatch Status:** ${dispatchStatus}\n\n`;

    const totalTriggered = dueToday.length + upcoming.length + (dayOfWeek === 'Monday' ? overdue.length : 0);

    if (totalTriggered === 0) {
      md += `> ✅ **All Clear:** No commitments due today, in the next 2 days, or pending weekly overdue digest.\n`;
    } else {
      if (dueToday.length > 0) {
        md += `### 🚨 Due Today (0 Days)\n`;
        md += `| Name | Amount (₹) | Category |\n|---|---|---|\n`;
        dueToday.forEach(i => {
          md += `| ${i.name} | ₹${i.cost || 0} | ${i.category || 'N/A'} |\n`;
        });
        md += `\n`;
      }
      
      if (upcoming.length > 0) {
        md += `### ⏳ Upcoming (Next 2 Days)\n`;
        md += `| Name | Amount (₹) | Due Date |\n|---|---|---|\n`;
        upcoming.forEach(i => {
          md += `| ${i.name} | ₹${i.cost || 0} | ${i.nextDue} |\n`;
        });
        md += `\n`;
      }

      md += `### ⚠️ Overdue (Weekly Digest)\n`;
      if (dayOfWeek !== 'Monday') {
        md += `*Skipped: Overdue digest only triggers on Mondays.*\n\n`;
      } else if (overdue.length === 0) {
        md += `*No overdue items!*\n\n`;
      } else {
        md += `| Name | Amount (₹) | Due Date | Days Overdue |\n|---|---|---|---|\n`;
        overdue.forEach(i => {
          md += `| ${i.name} | ₹${i.cost || 0} | ${i.nextDue} | ${Math.abs(i._diff)} Days |\n`;
        });
        md += `\n`;
      }
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md, 'utf-8');
      } catch (e) {
        console.error("Failed to write to GITHUB_STEP_SUMMARY:", e);
      }
    } else {
      console.log("\n--- GITHUB STEP SUMMARY ---");
      console.log(md);
      console.log("---------------------------\n");
    }
  };

  try {
    if (!PANTRY_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      throw new Error("Missing required environment variables.");
    }

    console.log("Fetching Fintrack data from Pantry...");
    const response = await fetch(PANTRY_URL);
    if (!response.ok) {
      throw new Error(`Pantry fetch failed with HTTP ${response.status}`);
    }
    const data = await response.json();

    const activeItems = data.activeItems || [];
    const oneTimeItems = data.oneTimeItems || [];
    const clearedDues = data.clearedDues || [];

    // Date Logic in IST
    const now = new Date();
    todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const todayDate = new Date(todayStr); // UTC Midnight of the local date
    dayOfWeek = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });

    console.log(`Processing for Today (IST): ${todayStr} (${dayOfWeek})`);

    const daysDiff = (dateStr) => {
      const d = new Date(dateStr);
      const diff = d.getTime() - todayDate.getTime();
      return Math.round(diff / (1000 * 60 * 60 * 24));
    };

    let totalItemsProcessed = 0;

    const processItem = (item, isOneTime) => {
      if (!item.nextDue) return;
      if (item.status === 'Paid') return; // Defensive check
      
      // Filter out cleared one-time items
      if (isOneTime) {
        const d = new Date(item.nextDue);
        const key = item.id + "_" + d.getTime();
        if (clearedDues.includes(key)) return;
      }

      const diff = daysDiff(item.nextDue);
      item._diff = diff; // store diff for summary
      totalItemsProcessed++;

      if (diff === 0) {
        dueToday.push(item);
      } else if (diff > 0 && diff <= 2) {
        upcoming.push(item);
      } else if (diff < 0) {
        overdue.push(item);
      }
    };

    activeItems.forEach(item => processItem(item, false));
    oneTimeItems.forEach(item => processItem(item, true));

    console.log(`Processed ${totalItemsProcessed} uncleared items.`);
    console.log(`Due Today: ${dueToday.length}, Upcoming next 2 days: ${upcoming.length}, Overdue: ${overdue.length}`);

    // Build the Telegram Message Payload
    let messageHtml = "";

    if (dueToday.length > 0) {
      messageHtml += `🚨 <b>DUE TODAY</b> 🚨\n`;
      dueToday.forEach(i => {
        messageHtml += `• ${i.name} (₹${i.cost || 0})\n`;
      });
      messageHtml += `\n`;
    }

    if (upcoming.length > 0) {
      messageHtml += `⏳ <b>Upcoming (Next 2 Days)</b>\n`;
      upcoming.forEach(i => {
        messageHtml += `• ${i.name} (₹${i.cost || 0})\n`;
      });
      messageHtml += `\n`;
    }

    if (dayOfWeek === 'Monday' && overdue.length > 0) {
      messageHtml += `⚠️ <b>OVERDUE DIGEST</b>\n`;
      overdue.forEach(i => {
        messageHtml += `• ${i.name} (₹${i.cost || 0}) <i>[Due: ${i.nextDue}]</i>\n`;
      });
      messageHtml += `\n`;
    }

    if (messageHtml.trim() === "") {
      console.log("No items triggered for today. Exiting cleanly.");
      dispatchStatus = 'Skipped - No dues found';
    } else {
      messageHtml = `🔔 <b>Fintrack Reminders</b>\n\n` + messageHtml.trim();

      console.log("Dispatching Telegram Notification...");
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const tgResponse = await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: messageHtml,
          parse_mode: 'HTML'
        })
      });

      if (!tgResponse.ok) {
        const errorText = await tgResponse.text();
        throw new Error(`Telegram API failed with HTTP ${tgResponse.status}: ${errorText}`);
      }
      
      dispatchStatus = 'Sent';
      console.log("Notification sent successfully.");
    }
    
    writeSummary();
    process.exit(0);

  } catch (err) {
    if (err.message !== 'Missing required environment variables.') { console.error('Error executing reminder workflow:', err); } else { console.error('Error: ' + err.message); }
    dispatchStatus = `Error - ${err.message}`;
    writeSummary();
    process.exit(1);
  }
}

run();
