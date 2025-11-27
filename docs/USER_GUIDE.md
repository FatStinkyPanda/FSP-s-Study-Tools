# FSP's Study Tools - User Guide

**Version:** 1.0.0

Welcome to FSP's Study Tools, an AI-powered learning platform designed to help you master any subject through intelligent study techniques and personalized learning paths.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Knowledge Base Management](#knowledge-base-management)
4. [Importing Study Materials](#importing-study-materials)
5. [Jasper AI Assistant](#jasper-ai-assistant)
6. [Study Sessions](#study-sessions)
7. [Tests and Quizzes](#tests-and-quizzes)
8. [Progress Tracking](#progress-tracking)
9. [Settings](#settings)
10. [Tips for Effective Learning](#tips-for-effective-learning)

---

## Getting Started

### First Launch

When you first launch FSP's Study Tools, you'll be greeted by the Dashboard. Before you can begin studying, you'll need to:

1. **Set up an AI Provider** - Go to Settings to configure your preferred AI provider (Google Gemini recommended)
2. **Create a Knowledge Base** - Organize your study materials into knowledge bases
3. **Import Content** - Add study materials from PDFs, Word documents, or other supported formats

### System Requirements

- **Operating System:** Windows 10/11, macOS 10.15+, or Linux
- **Memory:** 4GB RAM minimum, 8GB recommended
- **Storage:** 500MB for application, plus space for your study materials
- **Internet:** Required for AI features (optional for offline study)

---

## Dashboard Overview

The Dashboard is your central hub for all learning activities.

### Navigation Sidebar

The left sidebar provides quick access to all features:

- **Dashboard** - Overview and quick actions
- **Knowledge Bases** - Manage your study content
- **Study** - Start a study session
- **Tests** - Take or review tests
- **Progress** - View your learning analytics
- **Settings** - Configure the application

### Quick Stats

The dashboard displays:
- Total study time
- Recent activity
- Upcoming reviews (spaced repetition)
- Test scores and trends

---

## Knowledge Base Management

A Knowledge Base (KB) is a collection of related study materials organized into modules and chapters.

### Creating a Knowledge Base

1. Click **"Create New KB"** on the Dashboard or KB page
2. Enter a **title** (e.g., "CompTIA A+ Certification")
3. Add an optional **description**
4. Click **Create**

### Organizing Content

Each Knowledge Base contains:
- **Modules** - Major sections or units (e.g., "Networking Fundamentals")
- **Chapters** - Individual topics within modules (e.g., "OSI Model")

### Editing a Knowledge Base

- Click on a KB to view its contents
- Use the edit button to modify title or description
- Drag and drop to reorder modules
- Delete unused modules or chapters as needed

---

## Importing Study Materials

FSP's Study Tools supports multiple document formats for importing study content.

### Supported Formats

| Format | Extensions | Description |
|--------|-----------|-------------|
| PDF | .pdf | PDF documents with text extraction |
| Word | .docx | Microsoft Word documents |
| Markdown | .md, .markdown | Markdown files with structure |
| EPUB | .epub | E-book format |
| PowerPoint | .pptx | Presentation slides |
| Plain Text | .txt | Simple text files |

### How to Import

1. Open a Knowledge Base
2. Click **"Import Document"**
3. Select your file from the file browser
4. Wait for processing to complete
5. Review the imported content

### Import Tips

- **PDFs with images:** The system extracts both text and embedded images
- **Structured documents:** Headings and chapters are automatically detected
- **Large files:** Import may take longer; a progress indicator will be shown
- **Scanned PDFs:** OCR is not currently supported; use searchable PDFs

---

## Jasper AI Assistant

Jasper is your intelligent study companion powered by advanced AI.

### Starting a Conversation

1. Click the **Jasper** icon in the navigation or on the Dashboard
2. Type your question in the chat input
3. Press Enter or click Send

### What Jasper Can Do

- **Answer Questions** - Ask about any topic in your knowledge bases
- **Explain Concepts** - Get detailed explanations with examples
- **Generate Quizzes** - Create practice questions on the fly
- **Study Coaching** - Receive personalized study recommendations
- **Summarize Content** - Get concise summaries of lengthy material

### Voice Interaction

Jasper supports voice input and output:

1. Click the **microphone** icon to speak your question
2. Jasper will respond with text and optionally read the answer aloud
3. Enable/disable voice in Settings

### Context-Aware Responses

Jasper uses your knowledge bases for accurate, relevant answers:
- Select specific KBs to focus responses
- Jasper cites sources from your materials
- Ask follow-up questions for deeper understanding

### Jasper States

The orb animation indicates Jasper's current state:
- **Idle** - Ready for input
- **Listening** - Processing voice input
- **Thinking** - Generating a response
- **Speaking** - Reading response aloud

---

## Study Sessions

Engage with your materials through structured study sessions.

### Starting a Study Session

1. Go to **Study** in the navigation
2. Select a Knowledge Base
3. Choose modules/chapters to study
4. Select a **study mode**:
   - **Read & Review** - Browse content at your own pace
   - **Flashcards** - Quick recall practice
   - **Active Recall** - AI-generated questions
   - **Spaced Repetition** - Optimized review schedule

### Flashcard Mode

- Cards are generated from your content
- Flip cards to reveal answers
- Rate your recall (Easy, Medium, Hard)
- Difficult cards appear more frequently

### Spaced Repetition

The SM-2 algorithm optimizes your review schedule:
- New material reviewed frequently
- Mastered content reviewed less often
- Struggling topics get extra attention
- Daily review reminders keep you on track

---

## Tests and Quizzes

Test your knowledge with AI-generated assessments.

### Creating a Test

1. Go to **Tests** in the navigation
2. Click **"Generate New Test"**
3. Configure test settings:
   - **Knowledge Base** - Source material
   - **Modules** - Specific topics (optional)
   - **Question Count** - 5 to 100 questions
   - **Difficulty** - Easy, Medium, Hard, or Mixed
   - **Question Types** - Multiple choice, True/False, Fill-in-blank, Short answer

### Taking a Test

- Answer each question before moving to the next
- Use the navigation panel to jump between questions
- Flag questions for review
- Submit when complete

### Question Types

| Type | Description |
|------|-------------|
| Multiple Choice | Select the correct answer from 4 options |
| True/False | Determine if a statement is true or false |
| Fill-in-Blank | Complete the missing word or phrase |
| Short Answer | Write a brief response (AI-graded) |

### Reviewing Results

After completing a test:
- View your score and percentage
- See correct answers with explanations
- Identify weak areas for focused study
- Retake tests to track improvement

---

## Progress Tracking

Monitor your learning journey with detailed analytics.

### Progress Dashboard

- **Overall Progress** - Completion percentage across all KBs
- **Study Time** - Total and daily averages
- **Test Performance** - Scores and trends over time
- **Streak Counter** - Consecutive days studied

### Knowledge Base Progress

For each KB:
- Chapters completed vs. total
- Mastery level per topic
- Time spent studying
- Test scores related to that KB

### Spaced Repetition Stats

- Items due for review today
- Retention rate
- Average ease factor
- Upcoming review calendar

### Exporting Progress

Export your progress data:
1. Go to **Progress**
2. Click **Export**
3. Choose format (CSV or JSON)
4. Save the file

---

## Settings

Customize FSP's Study Tools to your preferences.

### AI Provider Configuration

1. Go to **Settings > AI Provider**
2. Select your provider:
   - **Google Gemini** (recommended)
   - **OpenAI GPT**
   - **Anthropic Claude**
   - **Ollama** (local, offline)
3. Enter your API key
4. Test the connection

### Getting API Keys

| Provider | How to Get Key |
|----------|---------------|
| Google Gemini | [Google AI Studio](https://makersuite.google.com/app/apikey) |
| OpenAI | [OpenAI Platform](https://platform.openai.com/api-keys) |
| Anthropic | [Anthropic Console](https://console.anthropic.com/) |
| Ollama | No key needed (local installation required) |

### Appearance

- **Theme** - Light, Dark, or System
- **Font Size** - Adjust text size
- **Accent Color** - Customize the interface

### Study Preferences

- **Daily Goal** - Set study time targets
- **Notifications** - Enable/disable reminders
- **Auto-play Audio** - Voice response settings
- **Spaced Repetition Settings** - Customize intervals

### Data Management

- **Backup** - Export all data
- **Restore** - Import from backup
- **Clear Data** - Reset application (caution!)

---

## Tips for Effective Learning

### Active Recall

Don't just re-read material. Test yourself frequently:
- Use Jasper to quiz you on topics
- Generate practice tests regularly
- Write summaries from memory

### Spaced Repetition

Let the system schedule your reviews:
- Study a little every day
- Don't cram before tests
- Trust the algorithm

### Interleaving

Mix up your study topics:
- Study multiple subjects in one session
- Switch between different modules
- Connect concepts across topics

### Elaboration

Go beyond the basics:
- Ask "why" and "how" questions
- Create your own examples
- Explain concepts to Jasper

### Time Management

Use study sessions effectively:
- Set specific goals for each session
- Take breaks (Pomodoro technique)
- Review your progress weekly

### Use Jasper Wisely

- Ask for explanations, not just answers
- Request examples and analogies
- Have Jasper test your understanding
- Get study recommendations based on weak areas

---

## Troubleshooting

### Common Issues

**AI not responding:**
- Check your internet connection
- Verify API key is valid
- Try switching AI providers

**Import failing:**
- Ensure file format is supported
- Check file isn't corrupted
- Try a smaller file first

**Application slow:**
- Close other applications
- Clear browser cache (for web version)
- Restart the application

**Progress not saving:**
- Check disk space
- Don't force-quit the application
- Use the backup feature regularly

### Getting Help

- Check the [FAQ](./FAQ.md) for common questions
- Report bugs at [GitHub Issues](https://github.com/yourusername/fsp-study-tools/issues)
- Join the community discussion

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New Knowledge Base |
| `Ctrl/Cmd + O` | Open file for import |
| `Ctrl/Cmd + J` | Open Jasper |
| `Ctrl/Cmd + S` | Start study session |
| `Ctrl/Cmd + T` | Generate new test |
| `Ctrl/Cmd + ,` | Open Settings |
| `Esc` | Close dialog/panel |
| `Space` | Flip flashcard |
| `1-4` | Rate flashcard difficulty |

---

## Privacy & Data

- **Local Storage** - All data stored on your computer
- **API Keys** - Encrypted and never shared
- **AI Requests** - Only sent when using AI features
- **No Tracking** - We don't collect usage data

Your study materials and progress remain private and under your control.

---

## Disclaimer and Terms

**IMPORTANT: By using FSP's Study Tools, you agree to the following terms:**

This software is provided **"AS-IS" WITHOUT WARRANTY OF ANY KIND**. The authors, developers, contributors, and affiliated parties accept **NO RESPONSIBILITY OR LIABILITY** for:

- Data loss or corruption
- Inaccuracies in AI-generated content
- System failures or issues
- Any consequences from relying on the software's output

The educational content and AI-generated materials are for **informational purposes only**. Do not rely solely on this software for certification exams or professional qualifications. Always verify information independently.

For complete terms, see the [LICENSE](../LICENSE) file.

---

## Support the Project

If FSP's Study Tools has helped you in your learning journey, consider supporting its continued development!

**Monetary Contributions:** Venmo [@FatStinkyPanda](https://venmo.com/FatStinkyPanda)

**Code Contributions:** Pull requests, bug reports, and feature suggestions are always welcome!

---

Happy studying! Remember: consistent practice beats cramming every time.
