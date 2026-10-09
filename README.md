# 🌙 Moonfill

**Run a Moonpull integration scan from Salesforce in one click, and get the result posted in the record's Chatter automatically.**

Moonfill is a browser extension for Awin agents. Before, you had to fill in the Moonpull form, wait for the result in Teams, copy it and paste it into Salesforce. Now you click one button and Moonfill does all of it.

---

## Why use it

- **One click.** No typing the MID or region, no form to fill in, no copy and paste.
- **Nothing to remember.** Moonfill reads the program, MID and country from the Salesforce record for you.
- **Work on something else.** While the scan runs (usually up to 10 minutes) you can use other tabs and other apps.
- **Several scans at once.** Start as many as you like, for the same client or different ones. Each result goes to its own record.
- **Always visible.** One click on the Moonfill icon shows what is running, what is done and what needs attention.
- **Safe by design.** Before posting, Moonfill checks that the result belongs to the MID you scanned. If not, nothing is posted.
- **A safety net.** If something goes wrong, a **Force paste** button and a **Copy result** button are one click away. The Teams message still arrives as usual.

---

## How it works

1. Open the program's record in Salesforce and click **🌙 Submit Moonpull form**.
2. A form tab opens, fills itself in, submits and closes. This takes about 25 seconds, then you are back on the record.
3. Moonfill waits for the scan to finish. You don't need to do anything.
4. When the result is ready, Moonfill opens the record in the background, posts the result to its **Chatter** feed and shows a notification.

**To follow your scans:** click the Moonfill icon in the toolbar.

| What you see | What it means |
|---|---|
| Submitting form… | The form is being filled in and sent |
| In progress (3m 20s) | The scan is running |
| Posting to Salesforce… | The result is ready and is being posted |
| Result ready · waiting for the browser to be in front | The browser window was hidden. The result will be posted as soon as you bring the browser to the front |
| Complete · pasted in Salesforce | Done. The card disappears after one minute and stays in **History** |
| Failed: … | Something went wrong. See "If something goes wrong" below |

The **History** button lists your latest scans with program, MID and status.

---

## What you need

- **Microsoft Edge or Google Chrome** on a computer.
- To be **signed in to Salesforce and Microsoft 365** in that same browser.
- **Access to the shared Moonpull results folder.** This is where the scan result is saved. Ask your team lead if you can't open it.

---

## Install (developer mode)

Moonfill is not in the browser store yet, so it is installed from the folder you received.

**Microsoft Edge**
1. Unzip the Moonfill folder somewhere permanent, for example in Documents. Don't delete it afterwards.
2. Open `edge://extensions`.
3. Turn on **Developer mode** (bottom left).
4. Click **Load unpacked** and select the Moonfill folder.
5. Click the puzzle icon in the toolbar and pin 🌙 Moonfill.

**Google Chrome**
1. Unzip the folder somewhere permanent.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the Moonfill folder.
5. Pin 🌙 Moonfill from the puzzle icon.

**To update:** replace the files in the folder with the new ones, open the extensions page again and click the **reload** icon on the Moonfill card.

---

## Golden rules to avoid problems

1. **Start from the record.** Always click **🌙 Submit Moonpull form** on the Salesforce record of the program you want to scan.
2. **Let the form finish.** Don't switch to another app during the first 25 seconds. The form needs to be on screen to fill itself in. When the tab closes, you are free.
3. **Keep the browser open.** You can minimize it, but don't close it until the card says Complete. If you close it by mistake, reopen it within 20 minutes and Moonfill carries on.
4. **Keep the browser visible when the result arrives, if you can.** If Edge or Chrome is hidden behind other windows, Salesforce can't draw its page, so the result waits. Leaving the browser visible on one of your screens avoids this. Otherwise it is posted as soon as you bring the browser to the front.
5. **Stay signed in.** If your Salesforce or Microsoft 365 session expires, Moonfill can't read the result or open the record. Sign in again and use Force paste if needed.
6. **Don't type in the Chatter box of that record** while its result is being posted.
7. **Don't scan the same MID twice by accident.** Each click is a new scan and gets its own post.
8. **Check the notification.** If you see "scan failed" or "result ready", open the Moonfill icon.

---

## If something goes wrong

| Message | What to do |
|---|---|
| Result ready · waiting for the browser | Bring Edge or Chrome to the front. It posts by itself within a few seconds. Or click **Force paste**. |
| Failed: Chatter tab not found / "Share an update..." box did not appear | Open the Moonfill icon and click **Force paste**. If it fails again, click **Copy result** and paste it into Chatter yourself. |
| Failed: no result after 20 minutes | The scan may have taken longer or failed. Check the Teams message. |
| Failed: result is for another MID | Nothing was posted. Check the Teams message and tell the project owner. |
| Can't read the result folder | Sign in to Microsoft 365 in this browser and check that you have access to the results folder. |
| The form opens but doesn't fill in | Don't click again. Tell the project owner. The form may have changed. |
| Nothing happens after clicking 🌙 | Reload the page and check that the extension is on in the extensions page. |

When you report a problem, please send a screenshot of the Moonfill card, the program name and the time.

---

## Good to know

- The result posted in Chatter is the same text as the Teams message, without your name and job title.
- The Teams message is still sent, so you always have a copy.
- Moonfill only talks to Microsoft Forms, the Moonpull results folder and Salesforce, using your own logins. It stores the scan list on your computer only.
- Moonfill is for scans started from a Salesforce record. There is no manual MID box anymore.

---

## Support

Built by Rodier for Awin agents. Questions, bugs and ideas: [GitHub Issues](https://github.com/OptimusRodier/moonfill) or contact the project owner.
