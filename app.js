/* ================================================================
   Aura AI — app.js
   Full AI chat engine with GPT integration, image gen simulation,
   data analysis charts, speech, PWA install, conversation history
   ================================================================ */
'use strict';

// ── Chart.js dark defaults ────────────────────────────────────────
Chart.defaults.color = '#8B92A8';
Chart.defaults.borderColor = 'hsla(220,20%,30%,0.5)';
Chart.defaults.font.family = "'Inter', sans-serif";

// ── Global state ──────────────────────────────────────────────────
const state = {
  conversations: JSON.parse(localStorage.getItem('aura_convos') || '[]'),
  currentConvoId: null,
  messages: [],
  model: 'GPT-4o',
  mode: 'general',
  tokens: 0,
  totalMsgs: 0,
  responseTimes: [],
  apiKey: localStorage.getItem('aura_api_key') || '',
  settings: JSON.parse(localStorage.getItem('aura_settings') || '{"markdown":true,"autoscroll":true,"sound":false,"save":true,"temperature":0.7,"maxTokens":4096,"systemPrompt":"assistant"}'),
  isTyping: false,
  deferredInstall: null,
  recognition: null,
  isRecording: false,
  tokenHistory: [0],
  pendingImageUrl: null,
  pendingImageName: null,
};

const SYSTEM_PROMPTS = {
  assistant: "You are Aura, a highly intelligent, friendly AI assistant. You provide thoughtful, accurate, well-structured responses. Use markdown formatting where helpful.",
  analyst:   "You are Aura, an expert data analyst AI. You excel at interpreting data, spotting trends, and generating actionable insights. Always structure your analysis clearly.",
  developer: "You are Aura, a senior full-stack developer AI. You write clean, efficient, production-ready code with proper error handling and documentation.",
  marketer:  "You are Aura, a marketing and growth expert AI. You craft compelling copy, develop strategies, and provide ROI-focused recommendations.",
};

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const messagesArea = $('messages-area');
const messagesInner = $('messages-inner');
const chatInput = $('chat-input');
const sendBtn = $('send-btn');

// ── Marked.js config ──────────────────────────────────────────────
if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}
function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && state.settings.markdown) {
    try { return marked.parse(text); } catch(e) {}
  }
  return text.replace(/\n/g, '<br>');
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = (icons[type] || '') + ' ' + msg;
  $('toast-wrap').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'all 0.3s';
    t.style.opacity = '0';
    t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 350);
  }, 3000);
}

// ── Conversation management ────────────────────────────────────────
function newConversation() {
  const id = 'convo_' + Date.now();
  state.currentConvoId = id;
  state.messages = [];
  state.tokens = 0;
  state.totalMsgs = 0;
  state.tokenHistory = [0];
  state.responseTimes = [];

  // Show welcome
  $('welcome-screen').style.display = 'flex';
  messagesInner.style.display = 'none';
  messagesInner.innerHTML = '';

  updateStats();
  updateTokenCounter();
  renderHistory();
  updateMiniChart();
}

function saveCurrentConvo(title) {
  if (!state.settings.save || !state.currentConvoId) return;
  const existing = state.conversations.findIndex(c => c.id === state.currentConvoId);
  const entry = { id: state.currentConvoId, title, messages: state.messages, tokens: state.tokens, date: new Date().toISOString() };
  if (existing >= 0) state.conversations[existing] = entry;
  else state.conversations.unshift(entry);
  localStorage.setItem('aura_convos', JSON.stringify(state.conversations.slice(0, 30)));
  renderHistory();
}

function loadConversation(id) {
  const convo = state.conversations.find(c => c.id === id);
  if (!convo) return;
  state.currentConvoId = id;
  state.messages = convo.messages;
  state.tokens = convo.tokens;

  $('welcome-screen').style.display = 'none';
  messagesInner.style.display = 'flex';
  messagesInner.innerHTML = '';

  state.messages.forEach(m => appendMessage(m.role, m.content, false));
  updateStats();
  updateTokenCounter();
  renderHistory();
  closeSidebar();
}

function renderHistory() {
  const hist = $('chat-history');
  if (state.conversations.length === 0) {
    hist.innerHTML = '<div style="color:var(--text-3);font-size:12px;text-align:center;padding:20px;">No conversations yet</div>';
    return;
  }
  hist.innerHTML = state.conversations.slice(0, 20).map(c => `
    <div class="chat-history-item ${c.id === state.currentConvoId ? 'active' : ''}" onclick="loadConversation('${c.id}')">
      <span class="chi-icon">💬</span>
      <span class="chi-text">${c.title}</span>
      <span class="chi-del" onclick="event.stopPropagation();deleteConvo('${c.id}')">✕</span>
    </div>`).join('');
}

function deleteConvo(id) {
  state.conversations = state.conversations.filter(c => c.id !== id);
  localStorage.setItem('aura_convos', JSON.stringify(state.conversations));
  if (state.currentConvoId === id) newConversation();
  else renderHistory();
}

function clearHistory() {
  if (!confirm('Delete all conversations?')) return;
  state.conversations = [];
  localStorage.removeItem('aura_convos');
  newConversation();
  showToast('All conversations cleared', 'success');
}

// ── Message rendering ─────────────────────────────────────────────
function appendMessage(role, content, save = true) {
  const isAI = role === 'assistant';

  // Hide welcome, show messages
  $('welcome-screen').style.display = 'none';
  messagesInner.style.display = 'flex';

  const now = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const msgEl = document.createElement('div');
  msgEl.className = `msg ${isAI ? 'ai' : 'user'}`;

  const contentHtml = isAI ? renderMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>');

  msgEl.innerHTML = `
    <div class="msg-avatar">${isAI ? '🤖' : '👤'}</div>
    <div class="msg-bubble">
      <div class="msg-name">
        ${isAI ? 'Aura AI' : 'You'}
        <span class="msg-time-label">${now}</span>
      </div>
      <div class="msg-content">${contentHtml}</div>
      <div class="msg-actions">
        <button class="msg-act-btn" onclick="copyMsg(this)">📋 Copy</button>
        ${isAI ? '<button class="msg-act-btn" onclick="regenMsg(this)">🔄 Regenerate</button>' : ''}
        ${isAI ? '<button class="msg-act-btn" onclick="speakMsg(this)">🔊 Speak</button>' : ''}
      </div>
    </div>`;

  messagesInner.appendChild(msgEl);

  if (save) {
    state.messages.push({ role, content });
    state.totalMsgs++;
    updateStats();
  }

  if (state.settings.autoscroll) {
    setTimeout(() => messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' }), 50);
  }
  return msgEl;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Typing indicator ──────────────────────────────────────────────
function showTyping() {
  const el = document.createElement('div');
  el.className = 'msg ai';
  el.id = 'typing-msg';
  el.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      <div class="msg-name">Aura AI <span class="msg-time-label">typing…</span></div>
      <div class="msg-content" style="padding:10px 16px;">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>`;
  messagesInner.appendChild(el);
  $('welcome-screen').style.display = 'none';
  messagesInner.style.display = 'flex';
  if (state.settings.autoscroll) messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' });
}
function hideTyping() {
  const el = $('typing-msg');
  if (el) el.remove();
}

// ── AI engine (with real API support) ────────────────────────────
async function callAI(userMessage) {
  const apiKey = state.apiKey;
  const systemPrompt = SYSTEM_PROMPTS[state.settings.systemPrompt || 'assistant'];

  // If real API key is set — call OpenAI
  if (apiKey && apiKey.startsWith('sk-')) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: state.model === 'GPT-4o' ? 'gpt-4o' : state.model === 'GPT-4 Turbo' ? 'gpt-4-turbo' : 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...state.messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
          ],
          temperature: parseFloat(state.settings.temperature || 0.7),
          max_tokens: parseInt(state.settings.maxTokens || 4096),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `API Error ${res.status}`);
      }
      const data = await res.json();
      const usage = data.usage?.total_tokens || 0;
      state.tokens += usage;
      state.tokenHistory.push(state.tokens);
      return data.choices[0]?.message?.content || 'No response.';
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  }

  // ── Demo mode (no API key) ─────────────────────────────────────
  await delay(800 + Math.random() * 1200);
  const msg = userMessage.toLowerCase();

  // Token estimation
  const estimatedTokens = Math.floor(userMessage.length / 4) + Math.floor(Math.random() * 200) + 100;
  state.tokens += estimatedTokens;
  state.tokenHistory.push(state.tokens);

  return generateDemoResponse(userMessage, state.mode);
}

function generateDemoResponse(msg, mode) {
  const lower = msg.toLowerCase();

  // Data/chart mode
  if (mode === 'analyze' || lower.includes('analyz') || lower.includes('chart') || lower.includes('data') || lower.includes('sales') || lower.includes('roi')) {
    return generateChartResponse(msg);
  }
  // Image generation
  if (mode === 'imagine' || lower.includes('generat') && lower.includes('image') || lower.includes('creat') && lower.includes('art') || lower.includes('imagine') || lower.includes('draw')) {
    return generateImageResponse(msg);
  }
  // Code
  if (mode === 'code' || lower.includes('code') || lower.includes('function') || lower.includes('python') || lower.includes('javascript') || lower.includes('sql')) {
    return generateCodeResponse(msg);
  }
  // Business plan
  if (lower.includes('business plan') || lower.includes('strategy') || lower.includes('startup')) {
    return `## 🚀 Business Plan: AI SaaS Product

### Executive Summary
An AI-powered SaaS platform targeting SMBs with automated analytics and actionable insights.

### Market Analysis
- **TAM:** $450B (Global SaaS market, 2024)
- **SAM:** $28B (AI-powered business tools)
- **SOM:** $280M (Year 3 target, realistic penetration)

### Core Value Proposition
> *"Turn your raw data into decisions in 60 seconds."*

### Revenue Model
- **Starter:** $49/mo — 5 users, basic analytics
- **Growth:** $149/mo — 25 users, AI insights
- **Enterprise:** $499/mo — unlimited, custom models

### Financial Projections
| Year | MRR | Customers | ARR |
|------|-----|-----------|-----|
| 1    | $12K | 80       | $144K |
| 2    | $85K | 520      | $1.02M |
| 3    | $280K| 1,800    | $3.36M |

### Go-to-Market Strategy
1. **Content-Led Growth** — SEO + LinkedIn thought leadership
2. **Product-Led Growth** — Freemium with viral referral loops
3. **Partnership Channel** — Integrate with Slack, Notion, Salesforce
4. **Paid Acquisition** — Google Ads at <$80 CAC target

### Next Steps
- [ ] Validate with 10 design partners (Month 1–2)
- [ ] Build MVP with core analytics features (Month 3–4)
- [ ] Launch beta with 50 users (Month 5)
- [ ] Raise Seed round ($1.5M) (Month 6)`;
  }
  // Email writing
  if (lower.includes('email') || lower.includes('write') || lower.includes('content')) {
    return `## ✍️ Professional Email: Product Launch

---

**Subject:** Introducing [Product Name] — The Smarter Way to [Benefit]

Dear [First Name],

I hope this message finds you well. I'm reaching out because I believe **[Product Name]** could significantly impact how your team handles [pain point].

### Why This Matters for You

Over the past [X months], we've worked with companies like **[Similar Company]** to achieve:
- **↑ 38%** increase in [key metric]
- **↓ 52%** reduction in [time/cost]
- **$2.4M** additional revenue generated in Q3

### What We're Offering

[Product Name] is an enterprise-grade solution that:
1. Automates [manual process]
2. Provides real-time [insights]
3. Integrates seamlessly with your existing [tools]

**We're offering an exclusive 30-day free trial** for enterprise teams — no credit card, no commitment.

> *"[Product Name] changed how we approach [area]. We'd never go back."*  
> — [Name], VP of Operations at [Company]

I'd love to schedule a 20-minute demo at your convenience. Would **[Day], [Time]** work?

Best regards,  
[Your Name]  
[Title] | [Company]  
[Phone] | [Email]

---
*Would you like me to customize this for a specific industry or adjust the tone?*`;
  }
  // Summary
  if (lower.includes('summarize') || lower.includes('summary') || lower.includes('key insights')) {
    const count = state.messages.length;
    return `## 📝 Conversation Summary

This session contains **${Math.ceil(count/2)} exchanges** across the following topics:

${state.messages.slice(-6).filter(m=>m.role==='user').map(m => `- ${m.content.slice(0,60)}${m.content.length>60?'…':''}`).join('\n') || '- General AI assistance session'}

**Key Themes:** AI capabilities, data analysis, content generation

**Tokens used this session:** ~${state.tokens.toLocaleString()}

*Need me to go deeper on any specific topic from our conversation?*`;
  }
  // Default intelligent response
  const defaults = [
    `Great question! Here's what I know about **${msg.slice(0,40)}**:\n\n${getContextualResponse(lower)}`,
    `I'd be happy to help with that. ${getContextualResponse(lower)}`,
    `Here's a comprehensive answer:\n\n${getContextualResponse(lower)}`,
  ];
  return defaults[Math.floor(Math.random() * defaults.length)];
}

function getContextualResponse(msg) {
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey'))
    return "Hello! 👋 I'm **Aura AI**, your intelligent assistant. I can help you with data analysis, writing, coding, image generation, and much more. What would you like to explore today?\n\n> **Tip:** Try switching modes using the toolbar above the chat input!";
  if (msg.includes('how are you') || msg.includes('how do you'))
    return "I'm running at full capacity and ready to help! 🚀 As an AI, I'm always excited about new conversations. What challenge can I help you tackle today?";
  if (msg.includes('what can you'))
    return "I'm capable of a wide range of tasks:\n\n- **📊 Data Analysis** — Upload CSVs, generate charts, find insights\n- **🎨 Image Generation** — Create AI art and visuals from text prompts\n- **💻 Code Generation** — Python, JavaScript, SQL, and more\n- **✍️ Content Writing** — Emails, blog posts, marketing copy\n- **🔍 Research** — Summarize topics, compare options, fact-check\n- **🧮 Math & Science** — Solve problems, explain concepts\n\nJust ask, or select a mode from the toolbar!";
  return "This is a fascinating topic. In **demo mode**, I'm generating intelligent responses without a live API key. To unlock full GPT-4o power with real-time knowledge, go to ⚙️ **Settings** and enter your OpenAI API key.\n\nFor now, I can still help with structured responses, data charts, code generation, and image placeholders. Try asking me to:\n- *\"Analyze my sales data\"*\n- *\"Generate an image of...\"*\n- *\"Write a Python script to...\"*";
}

// ── Chart response ─────────────────────────────────────────────────
function generateChartResponse(msg) {
  const chartId = 'chart_' + Date.now();
  setTimeout(() => renderAIChart(chartId, msg), 200);

  return `## 📊 Data Analysis Report

I've analyzed the data and generated a visual breakdown below. Here are the key insights:

### Key Findings
- **Top Performer:** Q3 showed the strongest results with 34% growth
- **Biggest Opportunity:** Email channel is underutilized — only 18% of budget but 28% of conversions
- **Alert:** Paid Social CPL increased 23% MoM — review targeting

### Recommendations
1. **Reallocate budget** from Paid Social → Email (projected +$24K revenue)
2. **Double down on Q4** — historical data shows 40% seasonal uplift
3. **Optimize mobile** — 62% of traffic but only 34% of conversions

<div class="ai-card"><div class="ai-card-title">📈 Visual Analysis</div><div class="ai-chart-wrap"><canvas id="${chartId}"></canvas></div></div>

> **Note:** In demo mode, chart uses sample data. Connect your data source for real analysis.`;
}

function renderAIChart(chartId, msg) {
  const canvas = document.getElementById(chartId);
  if (!canvas) return;

  const lower = msg.toLowerCase();
  const isBar = lower.includes('roi') || lower.includes('channel') || lower.includes('compar');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'];

  if (isBar) {
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Organic SEO','Paid Social','Email','Direct','Referral'],
        datasets: [
          { label:'Revenue ($K)', data:[42,28,35,18,12], backgroundColor:'hsl(217,91%,60%)', borderRadius:6 },
          { label:'Cost ($K)',    data:[8,22,5,0,3],      backgroundColor:'hsl(354,78%,58%)', borderRadius:6 },
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#8B92A8' } } }, scales:{ x:{ ticks:{ color:'#8B92A8' } }, y:{ ticks:{ color:'#8B92A8' } } } }
    });
  } else {
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label:'Revenue', data:[28,34,31,42,38,51,48,62,70,84], borderColor:'hsl(217,91%,60%)', backgroundColor:'hsla(217,91%,60%,0.1)', fill:true, tension:0.4, borderWidth:2 },
          { label:'Target',  data:[30,33,36,40,44,48,52,56,60,65], borderColor:'hsl(152,66%,46%)', borderDash:[5,3], tension:0.4, borderWidth:1.5 },
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#8B92A8' } } }, scales:{ x:{ ticks:{ color:'#8B92A8' } }, y:{ ticks:{ color:'#8B92A8', callback:v=>'$'+v+'K' } } } }
    });
  }
}

// ── Image gen response ─────────────────────────────────────────────
function generateImageResponse(msg) {
  const themes = ['🌌','🏙','🌊','🌿','🔥','✨','🎭','🎨'];
  const bgs = ['hsl(239,30%,15%)','hsl(280,30%,15%)','hsl(200,30%,15%)','hsl(160,30%,15%)','hsl(30,30%,15%)','hsl(350,30%,15%)'];
  const imgs = Array.from({length:4}, (_,i) => `<div class="img-gen-item" style="background:${bgs[i%bgs.length]}" onclick="showToast('Image saved!','success')">${themes[i*2]}${themes[i*2+1]}</div>`).join('');

  return `## 🎨 Image Generation Complete

Generated **4 variations** based on your prompt. Click any image to save.

<div class="ai-card">
  <div class="ai-card-title">🖼 Generated Images</div>
  <div class="img-gen-grid">${imgs}</div>
</div>

> **Tip:** In full mode with an API key, this would generate real AI images via DALL-E 3 or Stable Diffusion. Each image would be 1024×1024px, downloadable, and shareable.

**Prompt used:** *"${msg.slice(0, 80)}${msg.length > 80 ? '…' : ''}"*

Want me to **refine** any of these, try a **different style**, or generate a **wider/portrait** format?`;
}

// ── Code response ──────────────────────────────────────────────────
function generateCodeResponse(msg) {
  const lower = msg.toLowerCase();
  let code = '';

  if (lower.includes('python') || lower.includes('scrape')) {
    code = `import requests
from bs4 import BeautifulSoup
import pandas as pd
from typing import Optional
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def scrape_product_prices(
    url: str,
    selector: str = '.product-price',
    delay: float = 1.0
) -> list[dict]:
    """
    Scrape product prices from an e-commerce website.
    
    Args:
        url: Target URL to scrape
        selector: CSS selector for price elements
        delay: Rate limiting delay in seconds
    
    Returns:
        List of product dicts with name and price
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        products = []
        
        for item in soup.select('.product-item'):
            name  = item.select_one('.product-name')
            price = item.select_one(selector)
            
            if name and price:
                price_text = price.get_text(strip=True)
                price_val  = float(''.join(c for c in price_text if c.isdigit() or c == '.'))
                
                products.append({
                    'name':  name.get_text(strip=True),
                    'price': price_val,
                    'raw':   price_text,
                })
        
        logger.info(f"Scraped {len(products)} products from {url}")
        time.sleep(delay)  # Rate limiting
        return products
        
    except requests.RequestException as e:
        logger.error(f"Request failed: {e}")
        return []
    except Exception as e:
        logger.error(f"Parse error: {e}")
        return []


if __name__ == '__main__':
    results = scrape_product_prices('https://example.com/products')
    df = pd.DataFrame(results)
    print(df.to_string(index=False))
    df.to_csv('prices.csv', index=False)`;
  } else if (lower.includes('sql') || lower.includes('query')) {
    code = `-- Advanced E-Commerce Sales Analytics Query
-- Calculates revenue, customer segments, and product performance

WITH customer_metrics AS (
    SELECT
        customer_id,
        COUNT(DISTINCT order_id)                    AS total_orders,
        SUM(order_total)                            AS lifetime_value,
        MIN(created_at)                             AS first_order,
        MAX(created_at)                             AS last_order,
        DATEDIFF(DAY, MAX(created_at), GETDATE())  AS days_since_last_order
    FROM orders
    WHERE status = 'completed'
    GROUP BY customer_id
),
rfm_scores AS (
    SELECT
        customer_id,
        total_orders,
        lifetime_value,
        -- RFM Segmentation
        CASE
            WHEN days_since_last_order <= 30 THEN 'Active'
            WHEN days_since_last_order <= 90 THEN 'Lapsing'
            ELSE 'Churned'
        END AS recency_segment,
        CASE
            WHEN lifetime_value >= 1000 THEN 'VIP'
            WHEN lifetime_value >= 300  THEN 'Regular'
            ELSE 'New'
        END AS value_segment
    FROM customer_metrics
)
SELECT
    value_segment,
    recency_segment,
    COUNT(*)                   AS customers,
    SUM(lifetime_value)        AS total_revenue,
    AVG(lifetime_value)        AS avg_ltv,
    AVG(total_orders)          AS avg_orders
FROM rfm_scores
GROUP BY value_segment, recency_segment
ORDER BY total_revenue DESC;`;
  } else {
    code = `// AI-powered autocomplete utility with debouncing
// Works with any OpenAI-compatible endpoint

class AIAutocomplete {
  constructor(options = {}) {
    this.apiKey    = options.apiKey || '';
    this.model     = options.model  || 'gpt-4o-mini';
    this.debounce  = options.debounce || 300;
    this._timer    = null;
    this._cache    = new Map();
  }

  /**
   * Get AI-powered suggestions for a given input
   * @param {string} input - Current user input
   * @param {string} context - Optional context for better suggestions
   * @returns {Promise<string[]>} - Array of suggestion strings
   */
  async getSuggestions(input, context = '') {
    if (!input || input.length < 3) return [];

    // Check cache first
    const cacheKey = \`\${input}_\${context}\`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    return new Promise(resolve => {
      clearTimeout(this._timer);
      this._timer = setTimeout(async () => {
        try {
          const suggestions = await this._callAPI(input, context);
          this._cache.set(cacheKey, suggestions);
          resolve(suggestions);
        } catch (err) {
          console.error('Autocomplete error:', err);
          resolve([]);
        }
      }, this.debounce);
    });
  }

  async _callAPI(input, context) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${this.apiKey}\`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: 'user',
          content: \`Complete this: "\${input}"\nContext: \${context}\nReturn 3 completions as JSON array.\`,
        }],
        temperature: 0.4,
        max_tokens: 150,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0]?.message?.content || '{"suggestions":[]}');
    return parsed.suggestions || [];
  }
}

// Usage:
const ac = new AIAutocomplete({ apiKey: 'sk-...', debounce: 400 });
const input = document.querySelector('#my-input');
input.addEventListener('input', async () => {
  const suggestions = await ac.getSuggestions(input.value, 'e-commerce product search');
  console.log(suggestions);
});`;
  }

  return `## 💻 Code Generated\n\n\`\`\`${lower.includes('python') || lower.includes('scrape') ? 'python' : lower.includes('sql') ? 'sql' : 'javascript'}\n${code}\n\`\`\`\n\n### What this does:\n- ✅ Production-ready with proper error handling\n- ✅ Type hints / JSDoc documentation included\n- ✅ Follows best practices and clean code principles\n\nWant me to **add unit tests**, **explain** any section, or **adapt** this for a specific framework?`;
}

// ── Send message ──────────────────────────────────────────────────
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || state.isTyping) return;

  // Init conversation if needed
  if (!state.currentConvoId) newConversation();

  // Clear input and image preview
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  state.isTyping = true;

  removeImagePreview();

  // Show user message (with image thumbnail if attached)
  if (state.pendingImageUrl) {
    const imgHtml = `<img src="${state.pendingImageUrl}" style="max-width:260px;max-height:180px;border-radius:8px;display:block;margin-bottom:8px;border:1px solid var(--border);" alt="${escapeHtml(state.pendingImageName || 'image')}"/>`;
    appendMessageWithExtra('user', text, imgHtml);
    state.pendingImageUrl  = null;
    state.pendingImageName = null;
  } else {
    appendMessage('user', text);
  }

  // Show typing
  showTyping();

  const startTime = Date.now();
  try {
    const aiReply = await callAI(text);
    hideTyping();
    appendMessage('assistant', aiReply);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    state.responseTimes.push(parseFloat(elapsed));
    $('stat-avg').textContent = (state.responseTimes.reduce((a,b)=>a+b,0)/state.responseTimes.length).toFixed(1) + 's';

    // Save conversation with title from first message
    const title = text.length > 42 ? text.slice(0, 40) + '…' : text;
    if (state.messages.filter(m=>m.role==='user').length === 1) saveCurrentConvo(title);
    else saveCurrentConvo(state.conversations.find(c=>c.id===state.currentConvoId)?.title || title);

    updateTokenCounter();
    updateStats();
    updateMiniChart();

    if (state.settings.sound) playChime();
  } catch(err) {
    hideTyping();
    appendMessage('assistant', `❌ **Error:** ${err.message}\n\n*If you see an API error, please check your API key in Settings. In demo mode, no key is required.*`);
  }
  state.isTyping = false;
  sendBtn.disabled = chatInput.value.trim().length === 0;
}

// Variant of appendMessage that injects extra HTML (e.g. image preview) inside the user bubble
function appendMessageWithExtra(role, content, extraHtml) {
  const isAI = role === 'assistant';
  $('welcome-screen').style.display = 'none';
  messagesInner.style.display = 'flex';

  const now = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const msgEl = document.createElement('div');
  msgEl.className = `msg ${isAI ? 'ai' : 'user'}`;

  const contentHtml = isAI ? renderMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>');

  msgEl.innerHTML = `
    <div class="msg-avatar">${isAI ? '🤖' : '👤'}</div>
    <div class="msg-bubble">
      <div class="msg-name">
        ${isAI ? 'Aura AI' : 'You'}
        <span class="msg-time-label">${now}</span>
      </div>
      <div class="msg-content">${extraHtml}${contentHtml}</div>
      <div class="msg-actions">
        <button class="msg-act-btn" onclick="copyMsg(this)">📋 Copy</button>
      </div>
    </div>`;

  messagesInner.appendChild(msgEl);
  state.messages.push({ role, content });
  state.totalMsgs++;
  updateStats();

  if (state.settings.autoscroll) {
    setTimeout(() => messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' }), 50);
  }
  return msgEl;
}

// ── Utility functions ─────────────────────────────────────────────
function useSuggestion(text) {
  chatInput.value = text;
  chatInput.dispatchEvent(new Event('input'));
  sendMessage();
}

function copyMsg(btn) {
  const content = btn.closest('.msg-bubble').querySelector('.msg-content').textContent;
  navigator.clipboard.writeText(content).then(() => showToast('Copied!', 'success'));
}

function regenMsg(btn) {
  const lastUser = [...state.messages].reverse().find(m => m.role === 'user');
  if (lastUser) {
    state.messages.pop(); // remove last AI
    btn.closest('.msg').remove();
    chatInput.value = lastUser.content;
    sendMessage();
  }
}

function speakMsg(btn) {
  const text = btn.closest('.msg-bubble').querySelector('.msg-content').textContent;
  const utter = new SpeechSynthesisUtterance(text.slice(0, 300));
  utter.rate = 0.9;
  window.speechSynthesis.speak(utter);
  showToast('Speaking…', 'info');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

// ── Stats & counters ──────────────────────────────────────────────
function updateStats() {
  const userMsgs = state.messages.filter(m => m.role === 'user').length;
  $('stat-msgs').textContent = state.messages.length;
  $('stat-tokens').textContent = state.tokens.toLocaleString();
  $('stat-model').textContent = state.model;
}
function updateTokenCounter() {
  $('token-count').textContent = state.tokens.toLocaleString();
}

let miniChart = null;
function updateMiniChart() {
  const canvas = $('mini-chart-tokens');
  if (!canvas) return;
  const data = state.tokenHistory.slice(-10);
  if (miniChart) { miniChart.data.labels = data.map((_,i)=>i); miniChart.data.datasets[0].data = data; miniChart.update(); return; }
  miniChart = new Chart(canvas, {
    type: 'line',
    data: { labels: data.map((_,i)=>i), datasets: [{ data, borderColor:'hsl(217,91%,60%)', backgroundColor:'hsla(217,91%,60%,0.1)', fill:true, tension:0.4, pointRadius:0, borderWidth:2 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{display:false},y:{display:false}} }
  });
}

// ── Mode toggle ───────────────────────────────────────────────────
function toggleMode(mode) {
  state.mode = state.mode === mode ? 'general' : mode;
  ['analyze','imagine','code','search'].forEach(m => {
    const btn = $(`btn-${m}`);
    if (btn) btn.classList.toggle('active', state.mode === m);
  });
  const modeLabels = { general:'General', analyze:'📊 Data Analysis', imagine:'🎨 Image Generation', code:'💻 Code Mode', search:'🔍 Web Search' };
  $('mode-label').textContent = 'Mode: ' + (modeLabels[state.mode] || 'General');
  chatInput.placeholder = {
    general: 'Ask Aura anything… (Shift+Enter for new line)',
    analyze: '📊 Describe the data you want to analyze…',
    imagine: '🎨 Describe the image you want to generate…',
    code:    '💻 Describe the code you want me to write…',
    search:  '🔍 What do you want to search for?',
  }[state.mode] || 'Ask Aura anything…';
}

// ── Model selector ────────────────────────────────────────────────
function toggleModelDropdown() {
  $('model-dropdown').classList.toggle('open');
}
function selectModel(name, desc, icon) {
  state.model = name;
  $('current-model-name').textContent = name;
  $('model-dropdown').classList.remove('open');
  $('stat-model').textContent = name;
  showToast(`Switched to ${name}`, 'info');
  document.querySelectorAll('.model-opt').forEach(o => o.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}
document.addEventListener('click', e => {
  if (!$('model-selector').contains(e.target) && !$('model-dropdown').contains(e.target))
    $('model-dropdown').classList.remove('open');
});

// ── Sidebar / panels ──────────────────────────────────────────────
$('menu-toggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
  $('sidebar-overlay').style.display = $('sidebar').classList.contains('open') ? 'block' : 'none';
});
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').style.display = 'none';
}

let rpOpen = true;
function toggleRightPanel() {
  rpOpen = !rpOpen;
  $('right-panel').style.display = rpOpen ? 'flex' : 'none';
}

// ── Settings ──────────────────────────────────────────────────────
function openSettings() {
  $('settings-panel').classList.remove('hidden');
  $('api-key-input').value = state.apiKey;
  $('temp-slider').value = state.settings.temperature;
  $('temp-val').textContent = state.settings.temperature;
  $('toggle-markdown').checked = state.settings.markdown;
  $('toggle-autoscroll').checked = state.settings.autoscroll;
  $('toggle-sound').checked = state.settings.sound;
  $('toggle-save').checked = state.settings.save;
  $('max-tokens').value = state.settings.maxTokens;
  $('system-prompt-sel').value = state.settings.systemPrompt;
}
function closeSettings() { $('settings-panel').classList.add('hidden'); }
function saveSettings() {
  state.apiKey = $('api-key-input').value.trim();
  state.settings = {
    markdown:     $('toggle-markdown').checked,
    autoscroll:   $('toggle-autoscroll').checked,
    sound:        $('toggle-sound').checked,
    save:         $('toggle-save').checked,
    temperature:  parseFloat($('temp-slider').value),
    maxTokens:    parseInt($('max-tokens').value),
    systemPrompt: $('system-prompt-sel').value,
  };
  localStorage.setItem('aura_api_key', state.apiKey);
  localStorage.setItem('aura_settings', JSON.stringify(state.settings));
  closeSettings();
  showToast('Settings saved!', 'success');
  if (state.apiKey) showToast('API key saved — Real AI mode enabled!', 'success');
}

// ── New chat button ────────────────────────────────────────────────
$('new-chat-btn').addEventListener('click', () => { newConversation(); closeSidebar(); });

// ── Input auto-resize & Enter handling ────────────────────────────
chatInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 160) + 'px';
  sendBtn.disabled = !this.value.trim();
});

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

// ── Speech recognition ────────────────────────────────────────────
function toggleSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { showToast('Speech recognition not supported in this browser', 'warning'); return; }

  if (state.isRecording) {
    state.recognition?.stop();
    state.isRecording = false;
    $('mic-btn').classList.remove('recording');
    $('mic-btn').textContent = '🎙';
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.continuous = false;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';

  state.recognition.onresult = e => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    chatInput.value = transcript;
    chatInput.dispatchEvent(new Event('input'));
  };
  state.recognition.onend = () => {
    state.isRecording = false;
    $('mic-btn').classList.remove('recording');
    $('mic-btn').textContent = '🎙';
    if (chatInput.value.trim()) sendMessage();
  };
  state.recognition.onerror = () => {
    showToast('Speech error — try again', 'error');
    state.isRecording = false;
    $('mic-btn').classList.remove('recording');
    $('mic-btn').textContent = '🎙';
  };

  state.recognition.start();
  state.isRecording = true;
  $('mic-btn').classList.add('recording');
  $('mic-btn').textContent = '⏹';
  showToast('Listening… speak now', 'info');
}

// ── File upload (images + documents) ─────────────────────────────
const FILE_ICONS = {
  'pdf'  : '📄', 'doc'  : '📝', 'docx' : '📝',
  'xls'  : '📊', 'xlsx' : '📊', 'csv'  : '📊',
  'ppt'  : '📋', 'pptx' : '📋', 'txt'  : '📃',
};
const ALLOWED_EXTS = ['png','jpg','jpeg','gif','webp','svg','pdf','doc','docx','xls','xlsx','csv','txt','ppt','pptx'];

function getFileExt(name) { return name.split('.').pop().toLowerCase(); }

function getFileIcon(file) {
  if (file.type.startsWith('image/')) return null; // use thumbnail instead
  return FILE_ICONS[getFileExt(file.name)] || '📁';
}

function getPromptForFile(file) {
  const ext = getFileExt(file.name);
  if (file.type.startsWith('image/'))
    return `I've attached an image: "${file.name}". Please analyze it and describe what you see in detail.`;
  if (['xls','xlsx','csv'].includes(ext))
    return `I've uploaded a spreadsheet: "${file.name}". Please analyze the data, identify trends, and provide a detailed summary with key insights.`;
  if (['pdf'].includes(ext))
    return `I've uploaded a PDF document: "${file.name}". Please analyze its content and provide a detailed summary.`;
  if (['doc','docx'].includes(ext))
    return `I've uploaded a Word document: "${file.name}". Please review and summarize the content.`;
  if (['ppt','pptx'].includes(ext))
    return `I've uploaded a presentation: "${file.name}". Please summarize the key points.`;
  if (['txt'].includes(ext))
    return `I've uploaded a text file: "${file.name}". Please analyze and summarize the content.`;
  return `I've attached a file: "${file.name}". Please analyze its content.`;
}

function openFileUpload() { $('file-input').click(); }

function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const ext = getFileExt(file.name);
  if (!ALLOWED_EXTS.includes(ext)) {
    showToast(`⚠️ File type ".${ext}" is not supported. Allowed: Images, PDF, Word, Excel, CSV, PPT, TXT`, 'warning');
    input.value = '';
    return;
  }

  const isImage = file.type.startsWith('image/');
  const icon    = getFileIcon(file);
  const sizeTxt = file.size < 1024 * 1024
    ? (file.size / 1024).toFixed(1) + ' KB'
    : (file.size / (1024*1024)).toFixed(2) + ' MB';

  // Remove any existing preview
  const existingPreview = document.getElementById('img-preview-bar');
  if (existingPreview) existingPreview.remove();

  const bar = document.createElement('div');
  bar.id = 'img-preview-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 14px;' +
    'background:var(--surface-2);border-radius:10px;margin:6px 0;font-size:13px;color:var(--text-2);';

  if (isImage) {
    // For images: show thumbnail
    const reader = new FileReader();
    reader.onload = function(e) {
      bar.innerHTML = `
        <img src="${e.target.result}" style="height:48px;width:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" alt="preview"/>
        <div style="min-width:0;">
          <div style="font-weight:600;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(file.name)}</div>
          <div style="font-size:11px;color:var(--text-3);">${sizeTxt} · ${file.type}</div>
        </div>
        <button onclick="removeImagePreview()" style="margin-left:auto;flex-shrink:0;background:none;border:none;color:var(--text-3);cursor:pointer;font-size:20px;line-height:1;padding:0 4px;" title="Remove">×</button>`;
      state.pendingImageUrl  = e.target.result;
      state.pendingImageName = file.name;
    };
    reader.readAsDataURL(file);
  } else {
    // For documents: show icon
    bar.innerHTML = `
      <div style="font-size:32px;line-height:1;flex-shrink:0;">${icon}</div>
      <div style="min-width:0;">
        <div style="font-weight:600;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(file.name)}</div>
        <div style="font-size:11px;color:var(--text-3);">${sizeTxt} · ${ext.toUpperCase()} document</div>
      </div>
      <button onclick="removeImagePreview()" style="margin-left:auto;flex-shrink:0;background:none;border:none;color:var(--text-3);cursor:pointer;font-size:20px;line-height:1;padding:0 4px;" title="Remove">×</button>`;
    state.pendingImageUrl  = null;
    state.pendingImageName = null;
  }

  // Insert preview just above the textarea
  const inputWrap = document.querySelector('.input-box');
  inputWrap.parentNode.insertBefore(bar, inputWrap);

  // Pre-fill the prompt based on file type
  chatInput.value = getPromptForFile(file);
  chatInput.dispatchEvent(new Event('input'));

  input.value = '';
  showToast(`📎 "${file.name}" attached`, 'success');
}

function removeImagePreview() {
  const bar = document.getElementById('img-preview-bar');
  if (bar) bar.remove();
  state.pendingImageUrl  = null;
  state.pendingImageName = null;
  chatInput.value = '';
  chatInput.dispatchEvent(new Event('input'));
}


// ── Export ────────────────────────────────────────────────────────
function exportChat() {
  if (state.messages.length === 0) { showToast('No messages to export', 'warning'); return; }
  const text = state.messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}\n`).join('\n---\n\n');
  const blob = new Blob([`# Aura AI Chat Export\nDate: ${new Date().toLocaleString()}\nModel: ${state.model}\n\n---\n\n${text}`], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `aura-chat-${Date.now()}.md`; a.click();
  URL.revokeObjectURL(url);
  showToast('Chat exported!', 'success');
}

function shareChat() {
  if (navigator.share) {
    navigator.share({ title: 'Aura AI Chat', text: 'Check out my Aura AI conversation!', url: window.location.href }).catch(() => {});
  } else {
    navigator.clipboard.writeText(window.location.href).then(() => showToast('Link copied!', 'success'));
  }
}

// ── PWA Install ───────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.deferredInstall = e;
  setTimeout(() => $('install-banner').classList.remove('hidden'), 2000);
});

function triggerInstall() {
  if (state.deferredInstall) {
    state.deferredInstall.prompt();
    state.deferredInstall.userChoice.then(result => {
      if (result.outcome === 'accepted') {
        showToast('🎉 Aura AI installed successfully!', 'success');
        $('install-banner').classList.add('hidden');
      }
    });
  } else {
    showInstallGuide();
  }
}

function dismissInstall() { $('install-banner').classList.add('hidden'); }

function showInstallGuide() {
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = ua.includes('android');
  const isIOS     = ua.includes('iphone') || ua.includes('ipad');
  const isSafari  = ua.includes('safari') && !ua.includes('chrome');

  let msg = '';
  if (isAndroid)     msg = '📱 Android: Tap the 3-dot menu → "Add to Home screen" → Install';
  else if (isIOS)    msg = '📱 iPhone/iPad: Tap the Share icon → "Add to Home Screen" → Add';
  else               msg = '💻 Desktop Chrome: Click the install icon (⊕) in the address bar';

  useSuggestion('How do I install Aura AI as an app on my device?');
  setTimeout(() => showToast(msg, 'info'), 500);
}

window.addEventListener('appinstalled', () => {
  showToast('🎉 Aura AI installed!', 'success');
  $('install-banner').classList.add('hidden');
});

// ── Service Worker registration ───────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(r => console.log('SW registered:', r.scope))
      .catch(e => console.log('SW registration failed:', e));
  });
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  newConversation();
  renderHistory();
  updateMiniChart();

  // Restore settings
  if (state.settings) {
    // Applied on use
  }

  // Show welcome toast
  setTimeout(() => {
    const hasKey = !!state.apiKey;
    if (hasKey) {
      showToast('🔑 API key loaded — Real AI mode active!', 'success');
    } else {
      showToast('👋 Welcome to Aura AI — Demo mode active', 'info');
    }
  }, 800);
}

init();
