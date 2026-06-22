import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialization helper for Gemini SDK to prevent crash if key is missing
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// REST endpoints
// 1. Live and Upcoming Matches Endpoint
app.get("/api/sports-feed", async (req, res) => {
  const ai = getGeminiClient();
  const queryLeague = req.query.league || "Premier League & La Liga & NBA & Table Tennis & Boxing";

  if (!ai) {
    // Elegant, highly realistic fallback sports matches if Gemini is not key-configured
    return res.json({
      matches: getFallbackMatches(),
      source: "simulation",
    });
  }

  try {
    const prompt = `Return a list of 10-14 real-life ongoing or upcoming matches across various world sports from ${queryLeague} (including Soccer, Basketball/NBA, Table Tennis, Boxing/UFC). For each match, provide:
- Home team or player 1
- Away team or player 2
- League or event/championship
- Status ("LIVE" or "UPCOMING")
- Time/date or active match minute (e.g. "68'", "12'", "Quarter 3", "Round 5", etc.)
- Scores (e.g. "2 - 1", "98 - 92", "2 sets - 1 set", "0 - 0" or "-" if UPCOMING)
- Realistic Bookmaker decimal odds (1, X, 2)
- Match description or quick trivia (e.g. "Battle for NBA finals", "KPL Mashemeji derby", "WTT Contender")
- Sport type (strictly "Football" | "Basketball" | "Table Tennis" | "Boxing")
- flActiveCount (number of active challengers, between 100 and 2500)

Return the response in strict JSON format matching this schema:
{
  "matches": [
    {
      "id": string,
      "homeTeam": string,
      "awayTeam": string,
      "league": string,
      "status": "LIVE" | "UPCOMING",
      "time": string,
      "score": string,
      "odds": {
        "1": number,
        "X": number,
        "2": number
      },
      "trivia": string,
      "sport": string,
      "flActiveCount": number
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["matches"],
          properties: {
            matches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "homeTeam", "awayTeam", "league", "status", "time", "score", "odds", "trivia", "sport", "flActiveCount"],
                properties: {
                  id: { type: Type.STRING },
                  homeTeam: { type: Type.STRING },
                  awayTeam: { type: Type.STRING },
                  league: { type: Type.STRING },
                  status: { type: Type.STRING },
                  time: { type: Type.STRING },
                  score: { type: Type.STRING },
                  odds: {
                    type: Type.OBJECT,
                    required: ["1", "X", "2"],
                    properties: {
                      "1": { type: Type.NUMBER },
                      "X": { type: Type.NUMBER },
                      "2": { type: Type.NUMBER },
                    },
                  },
                  trivia: { type: Type.STRING },
                  sport: { type: Type.STRING },
                  flActiveCount: { type: Type.NUMBER },
                },
              },
            },
          },
        },
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true },
        systemInstruction: "You are an expert sports crawler. Provide real and recent sports data. Ground your response using Google Search if necessary.",
      },
    });

    const output = response.text ? JSON.parse(response.text.trim()) : { matches: getFallbackMatches() };
    res.json({
      ...output,
      source: "gemini-grounding",
    });
  } catch (error) {
    console.error("Gemini Sports Feed Error:", error);
    res.json({
      matches: getFallbackMatches(),
      source: "simulation-fallback",
    });
  }
});

// 2. Generate Commentary / Crowd Banter Endpoint
app.post("/api/generate-commentary", async (req, res) => {
  const ai = getGeminiClient();
  const { homeTeam, awayTeam, minute, score } = req.body;

  if (!ai) {
    return res.json({
      commentaries: getFallbackCommentaries(homeTeam, awayTeam, minute, score),
    });
  }

  try {
    const prompt = `Develop 3 separate realistic and entertaining match commentaries or crowd updates for a live broadcast of a football match between ${homeTeam} and ${awayTeam}. 
The current match state is Minute: ${minute || "75'"}, Score: ${score || "1 - 1"}.
Generate three pieces of text:
1. Dynamic, high-energy lead commentator play-by-play (highly dramatic!)
2. Local pub/crowd reactions or banter (funny, talking about betting slips and liabilities!)
3. Technical tactical analysis (expert breakdown)

Return JSON in this format:
{
  "leadCommentary": string,
  "crowdBanter": string,
  "tacticalAnalysis": string
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["leadCommentary", "crowdBanter", "tacticalAnalysis"],
          properties: {
            leadCommentary: { type: Type.STRING },
            crowdBanter: { type: Type.STRING },
            tacticalAnalysis: { type: Type.STRING },
          },
        },
      },
    });

    const parsed = response.text ? JSON.parse(response.text.trim()) : null;
    res.json(parsed || { commentaries: getFallbackCommentaries(homeTeam, awayTeam, minute, score) });
  } catch (err) {
    console.error("Gemini Commentary Error:", err);
    res.json({
      leadCommentary: `Dramatic turn here as both teams push forward! Fans are on the edge of their seats as ${homeTeam} looks to break the deadlock against ${awayTeam}.`,
      crowdBanter: `Collins in the pub: "I've got $150 riding on a Draw here, if anyone scores, my wallet is done for!"`,
      tacticalAnalysis: "Teams have shifted to a high-press 4-3-3 structure, looking to exploit wide channels in transition.",
    });
  }
});

// 3. Social Media AI Post Generator
app.get("/api/generate-posts", async (req, res) => {
  const ai = getGeminiClient();

  if (!ai) {
    return res.json({
      posts: getFallbackPosts(),
    });
  }

  try {
    const prompt = `Generate a list of 4 highly interactive, realistic, and humorous Facebook-style sports betting and banter posts for our site 'Facelook Bet'. 
These people should sound like normal users, talking about current sports events, challenging friends, losing slips, complaining about VAR, celebrating big wins, or proposing peer-to-peer bets.
Ensure at least one post is a completed or open P2P challenge bet where users are debating.

Return the response in this JSON format:
{
  "posts": [
    {
      "id": string,
      "author": string,
      "avatar": string,
      "time": string,
      "content": string,
      "likes": number,
      "comments": [
        {
          "author": string,
          "content": string,
          "time": string
        }
      ],
      "betCard": { // Optional, if they are attaching a bet
        "match": string,
        "type": string,
        "prediction": string,
        "odds": number,
        "totalPool": number,
        "stakes": { "creator": number, "opponents": number },
        "status": "OPEN" | "MATCHED" | "RESOLVED"
      }
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["posts"],
          properties: {
            posts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "author", "avatar", "time", "content", "likes", "comments"],
                properties: {
                  id: { type: Type.STRING },
                  author: { type: Type.STRING },
                  avatar: { type: Type.STRING },
                  time: { type: Type.STRING },
                  content: { type: Type.STRING },
                  likes: { type: Type.NUMBER },
                  comments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["author", "content", "time"],
                      properties: {
                        author: { type: Type.STRING },
                        content: { type: Type.STRING },
                        time: { type: Type.STRING },
                      },
                    },
                  },
                  betCard: {
                    type: Type.OBJECT,
                    required: ["match", "type", "prediction", "odds", "totalPool", "stakes", "status"],
                    properties: {
                      match: { type: Type.STRING },
                      type: { type: Type.STRING },
                      prediction: { type: Type.STRING },
                      odds: { type: Type.NUMBER },
                      totalPool: { type: Type.NUMBER },
                      stakes: {
                        type: Type.OBJECT,
                        required: ["creator", "opponents"],
                        properties: {
                          creator: { type: Type.NUMBER },
                          opponents: { type: Type.NUMBER },
                        },
                      },
                      status: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const parsed = response.text ? JSON.parse(response.text.trim()) : { posts: getFallbackPosts() };
    res.json(parsed);
  } catch (error) {
    console.error("Gemini Posts Error:", error);
    res.json({
      posts: getFallbackPosts(),
    });
  }
});

// 4. Star AI Chat Endpoint
app.post("/api/nyota-chat", async (req, res) => {
  const ai = getGeminiClient();
  const { messages } = req.body;

  if (!ai) {
    return res.json({
      reply: "I'm sorry, Star AI is currently offline as the Gemini connection is not configured.",
    });
  }

  try {
    // Determine the history format. Gemini expects an array of objects with 'role' and 'parts'
    const systemPrompt = `You are Star AI, a friendly, helpful, and highly intelligent AI assistant integrated into FaceLook Bet. 
You can chat about anything, assist users with the FaceLook Bet platform, explain how betting works, create pictures, edit pictures, help with research, and more. 
Keep your answers clear, supportive, and engaging.`;

    const chat = ai.chats.create({
      model: "gemini-3.5-flash",
      config: {
        systemInstruction: systemPrompt,
      }
    });

    let reply = "No response from Star AI.";

    if (messages && messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      
      const prevMessages = messages.slice(0, -1).map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{text: m.content}]
      }));

      const finalChat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction: systemPrompt,
        },
        history: prevMessages
      });

      const response = await finalChat.sendMessage({ message: latestMessage.content });
      reply = response.text || "No text returned.";
    }

    res.json({ reply });
  } catch (error) {
    console.error("Star AI Error:", error);
    res.json({
      reply: "Oops, I encountered a glitch in my system. Let's try that again!",
    });
  }
});
function getFallbackMatches() {
  return [
    {
      id: "m-1",
      homeTeam: "Manchester United",
      awayTeam: "Chelsea",
      league: "English Premier League",
      status: "LIVE",
      time: "68'",
      score: "2 - 1",
      odds: { "1": 1.75, "X": 3.40, "2": 4.10 },
      trivia: "Old Trafford is rocking! Manchester United is struggling to preserve their thin lead against Chelsea's second half surge.",
      sport: "Football",
      flActiveCount: 1420,
    },
    {
      id: "m-2",
      homeTeam: "Real Madrid",
      awayTeam: "Barcelona",
      league: "Spanish La Liga",
      status: "UPCOMING",
      time: "Today 21:00",
      score: "0 - 0",
      odds: { "1": 1.95, "X": 3.80, "2": 3.20 },
      trivia: "El Clasico is here! Both Bellingham and Yamal are fit and starting. P2P global challenges are breaking records.",
      sport: "Football",
      flActiveCount: 2280,
    },
    {
      id: "m-3",
      homeTeam: "Boston Celtics",
      awayTeam: "Dallas Mavericks",
      league: "NBA Playoffs",
      status: "LIVE",
      time: "Quarter 3",
      score: "88 - 82",
      odds: { "1": 1.45, "X": 15.00, "2": 2.85 },
      trivia: "Luka Doncic is on fire with 32 points, but Celtics' perimeter defense is clamping down. Active look-upto handshakes are live.",
      sport: "Basketball",
      flActiveCount: 1150,
    },
    {
      id: "m-4",
      homeTeam: "Ma Long",
      awayTeam: "Fan Zhendong",
      league: "WTT Grand Smash Championship",
      status: "LIVE",
      time: "Set 4",
      score: "2 sets - 1 set",
      odds: { "1": 2.20, "X": 22.00, "2": 1.60 },
      trivia: "An legendary table tennis clash. Ma Long is displaying his signature forehand loops to fight Fan Zhendong's speed.",
      sport: "Table Tennis",
      flActiveCount: 540,
    },
    {
      id: "m-5",
      homeTeam: "Tyson Fury",
      awayTeam: "Oleksandr Usyk",
      league: "Undisputed Heavyweight Title",
      status: "UPCOMING",
      time: "Tonight 23:30",
      score: "0 - 0",
      odds: { "1": 2.10, "X": 17.00, "2": 1.80 },
      trivia: "The historic heavyweight crown rematch of the century. Handshakes on Round bets are active in the LOOK groups.",
      sport: "Boxing",
      flActiveCount: 1950,
    },
    {
      id: "m-6",
      homeTeam: "Gor Mahia",
      awayTeam: "AFC Leopards",
      league: "Kenya Premier League (Ligi Bigi)",
      status: "LIVE",
      time: "82'",
      score: "1 - 1",
      odds: { "1": 2.10, "X": 2.80, "2": 3.00 },
      trivia: "The famous Mashemeji Derby. Tens of thousands of fans are singing. Live ratio challenges are multiplying.",
      sport: "Football",
      flActiveCount: 1670,
    },
    {
      id: "m-7",
      homeTeam: "Los Angeles Lakers",
      awayTeam: "Golden State Warriors",
      league: "NBA Regular Season",
      status: "UPCOMING",
      time: "Tomorrow 04:30",
      score: "0 - 0",
      odds: { "1": 1.85, "X": 14.00, "2": 1.95 },
      trivia: "LeBron James vs Steph Curry. One of the greatest rivalries of this basketball generation. Expect massive P2P engagements.",
      sport: "Basketball",
      flActiveCount: 1890,
    },
    {
      id: "m-8",
      homeTeam: "Hugo Calderano",
      awayTeam: "Tomokazu Harimoto",
      league: "ITTF World Tour",
      status: "UPCOMING",
      time: "Tomorrow 14:15",
      score: "0 - 0",
      odds: { "1": 2.05, "X": 18.00, "2": 1.75 },
      trivia: "Top-tier table tennis matching. Calderano's power vs Harimoto's offensive blocks and loud counter shouts.",
      sport: "Table Tennis",
      flActiveCount: 320,
    },
    {
      id: "m-9",
      homeTeam: "Canelo Alvarez",
      awayTeam: "Edgar Berlanga",
      league: "Super Middleweight Championship",
      status: "LIVE",
      time: "Round 5",
      score: "Decision Pending",
      odds: { "1": 1.15, "X": 25.00, "2": 5.50 },
      trivia: "Canelo is dictating the pace of the match with powerful left hooks, but Berlanga's reach is keeping him active.",
      sport: "Boxing",
      flActiveCount: 1480,
    }
  ];
}

// Fallback Commentaries
function getFallbackCommentaries(home: string, away: string, minute: string, score: string) {
  return {
    leadCommentary: `[${minute || "75'"}] Unbelievable tempo at the stadium as ${home} locks horns with ${away}! The crowd is absolutely roaring. The scoreboard says ${score || "1 - 1"}. A stray pass gives away possession and counter-attacks are threatening.`,
    crowdBanter: `Sloppy tackle in the midfield. Fan comment: "If ${home} loses this after I challenged Sarah L. on it, I'm never hearing the end of it in the WhatsApp group!"`,
    tacticalAnalysis: `High vertical transition play from both squads. ${home} is holding 54% ball possession, deploying wide overlaps, but ${away} has compact center-backs denying deep runs.`,
  };
}

// Fallback active feed posts
function getFallbackPosts() {
  return [
    {
      id: "p-fb-1",
      author: "David T.",
      avatar: "https://ui-avatars.com/api/?name=David+T&background=ff5722&color=fff",
      time: "45 minutes ago",
      content: "Who wants to bet Chelsea is going to pull a draw at Old Trafford? I am loaded and willing to split a ratio-based challenge pool. Let's make this interesting inside the LookUpto engine! Chelsea's odds are looking sweet.",
      likes: 12,
      comments: [
        {
          author: "Collins Dnego",
          content: "I already activated the engine and selected you David! Let's lock in $100 total pool. I've got Man U to secure the three points.",
          time: "40 minutes ago",
        },
        {
          author: "Sarah L.",
          content: "I am backing the Draw pool. Old Trafford isn't the fortress it used to be. Standard 1v1 lookupto is ready.",
          time: "15 minutes ago",
        },
      ],
      betCard: {
        match: "Manchester United vs Chelsea",
        type: "Ratio Challenge: Draw (@3.40)",
        prediction: "Draw (X)",
        odds: 3.40,
        totalPool: 100,
        stakes: { creator: 34.0, opponents: 66.0 },
        status: "OPEN",
      },
    },
    {
      id: "p-fb-2",
      author: "Emma W.",
      avatar: "https://ui-avatars.com/api/?name=Emma+W&background=3f51b5&color=fff",
      time: "1 hour ago",
      content: "Gor Mahia vs AFC Leopards is absolute fire today! My bet has Gor Mahia, and we are tied at 1-1 in the 82nd minute. Come on, one final corner kick is all we need to print!",
      likes: 8,
      comments: [
        {
          author: "John M.",
          content: "Leopards are defending with 10 players, no way they concede now.",
          time: "45 mins ago",
        },
      ],
    },
    {
      id: "p-fb-3",
      author: "Marcus_88",
      avatar: "https://ui-avatars.com/api/?name=Marcus&background=9c27b0&color=fff",
      time: "3 hours ago",
      content: "Just loaded $500 to my Facelook Wallet. I am looking for the highest roller in the community to challenge me on the World Cup qualifications. Open to custom handicap ratios. Hit the reply or match me in the FL Count panel!",
      likes: 24,
      comments: [
        {
          author: "Collins Dnego",
          content: "I'll match you for $200! Give me Germany to win, and you can take Ivory Coast's ratio.",
          time: "2 hours ago",
        },
      ],
      betCard: {
        match: "Germany vs Ivory Coast",
        type: "High Roller Global",
        prediction: "Germany (1)",
        odds: 1.54,
        totalPool: 500,
        stakes: { creator: 233.0, opponents: 267.0 },
        status: "MATCHED",
      },
    },
  ];
}

// Vite integration
async function startServer() {
  // Setup Vite middleware in development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving from dist
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Facelook Bet Server] listening on port ${PORT}`);
  });
}

startServer();
