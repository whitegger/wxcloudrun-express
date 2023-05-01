// src/index.ts
import express from "express";

// src/chatgpt/index.ts
import * as dotenv from "dotenv";
import "isomorphic-fetch";
import { ChatGPTAPI, ChatGPTUnofficialProxyAPI } from "chatgpt";
import { SocksProxyAgent } from "socks-proxy-agent";
import httpsProxyAgent from "https-proxy-agent";
import fetch from "node-fetch";

// src/utils/index.ts
function sendResponse(options) {
  if (options.type === "Success") {
    return Promise.resolve({
      message: options.message ?? null,
      data: options.data ?? null,
      status: options.type
    });
  }
  return Promise.reject({
    message: options.message ?? "Failed",
    data: options.data ?? null,
    status: options.type
  });
}

// src/utils/is.ts
function isNotEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

// src/chatgpt/index.ts
var { HttpsProxyAgent } = httpsProxyAgent;
dotenv.config();
var ErrorCodeMessage = {
  401: "[OpenAI] \u63D0\u4F9B\u9519\u8BEF\u7684API\u5BC6\u94A5 | Incorrect API key provided",
  403: "[OpenAI] \u670D\u52A1\u5668\u62D2\u7EDD\u8BBF\u95EE\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5 | Server refused to access, please try again later",
  502: "[OpenAI] \u9519\u8BEF\u7684\u7F51\u5173 |  Bad Gateway",
  503: "[OpenAI] \u670D\u52A1\u5668\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5 | Server is busy, please try again later",
  504: "[OpenAI] \u7F51\u5173\u8D85\u65F6 | Gateway Time-out",
  500: "[OpenAI] \u670D\u52A1\u5668\u7E41\u5FD9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5 | Internal Server Error"
};
var timeoutMs = !isNaN(+process.env.TIMEOUT_MS) ? +process.env.TIMEOUT_MS : 100 * 1e3;
var disableDebug = process.env.OPENAI_API_DISABLE_DEBUG === "true";
var apiModel;
var model = isNotEmptyString(process.env.OPENAI_API_MODEL) ? process.env.OPENAI_API_MODEL : "gpt-3.5-turbo";
if (!isNotEmptyString(process.env.OPENAI_API_KEY) && !isNotEmptyString(process.env.OPENAI_ACCESS_TOKEN))
  throw new Error("Missing OPENAI_API_KEY or OPENAI_ACCESS_TOKEN environment variable");
var api;
(async () => {
  if (isNotEmptyString(process.env.OPENAI_API_KEY)) {
    const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL;
    const DECODE_API_KEY = Buffer.from(process.env.OPENAI_API_KEY, "base64").toString();
    const options = {
      apiKey: DECODE_API_KEY,
      completionParams: { model },
      debug: !disableDebug
    };
    if (model.toLowerCase().includes("gpt-4")) {
      if (model.toLowerCase().includes("32k")) {
        options.maxModelTokens = 32768;
        options.maxResponseTokens = 8192;
      } else {
        options.maxModelTokens = 8192;
        options.maxResponseTokens = 2048;
      }
    }
    if (isNotEmptyString(OPENAI_API_BASE_URL))
      options.apiBaseUrl = `${OPENAI_API_BASE_URL}/v1`;
    setupProxy(options);
    api = new ChatGPTAPI({ ...options });
    apiModel = "ChatGPTAPI";
  } else {
    const options = {
      accessToken: process.env.OPENAI_ACCESS_TOKEN,
      apiReverseProxyUrl: isNotEmptyString(process.env.API_REVERSE_PROXY) ? process.env.API_REVERSE_PROXY : "https://ai.fakeopen.com/api/conversation",
      model,
      debug: !disableDebug
    };
    setupProxy(options);
    api = new ChatGPTUnofficialProxyAPI({ ...options });
    apiModel = "ChatGPTUnofficialProxyAPI";
  }
})();
async function chatReplyProcess(options) {
  const { message, lastContext, process: process2, systemMessage, temperature, top_p } = options;
  try {
    let options2 = { timeoutMs };
    if (apiModel === "ChatGPTAPI") {
      if (isNotEmptyString(systemMessage))
        options2.systemMessage = systemMessage;
      options2.completionParams = { model, temperature, top_p };
    }
    if (lastContext != null) {
      if (apiModel === "ChatGPTAPI")
        options2.parentMessageId = lastContext.parentMessageId;
      else
        options2 = { ...lastContext };
    }
    const response = await api.sendMessage(message, {
      ...options2,
      onProgress: (partialResponse) => {
        process2?.(partialResponse);
      }
    });
    return sendResponse({ type: "Success", data: response });
  } catch (error) {
    const code = error.statusCode;
    global.console.log(error);
    if (Reflect.has(ErrorCodeMessage, code))
      return sendResponse({ type: "Fail", message: ErrorCodeMessage[code] });
    return sendResponse({ type: "Fail", message: error.message ?? "Please check the back-end console" });
  }
}
async function fetchUsage() {
  const OPENAI_API_KEY = Buffer.from(process.env.OPENAI_API_KEY, "base64").toString();
  const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL;
  if (!isNotEmptyString(OPENAI_API_KEY))
    return Promise.resolve("-");
  const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL) ? OPENAI_API_BASE_URL : "https://api.openai.com";
  const [startDate, endDate] = formatDate();
  const urlUsage = `${API_BASE_URL}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`;
  const headers = {
    "Authorization": `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };
  const options = {};
  setupProxy(options);
  try {
    const useResponse = await options.fetch(urlUsage, { headers });
    if (!useResponse.ok)
      throw new Error("\u83B7\u53D6\u4F7F\u7528\u91CF\u5931\u8D25");
    const usageData = await useResponse.json();
    const usage = Math.round(usageData.total_usage) / 100;
    return Promise.resolve(usage ? `$${usage}` : "-");
  } catch (error) {
    global.console.log(error);
    return Promise.resolve("-");
  }
}
function formatDate() {
  const today = /* @__PURE__ */ new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const lastDay = new Date(year, month, 0);
  const formattedFirstDay = `${year}-${month.toString().padStart(2, "0")}-01`;
  const formattedLastDay = `${year}-${month.toString().padStart(2, "0")}-${lastDay.getDate().toString().padStart(2, "0")}`;
  return [formattedFirstDay, formattedLastDay];
}
async function chatConfig() {
  const usage = await fetchUsage();
  const reverseProxy = process.env.API_REVERSE_PROXY ?? "-";
  const httpsProxy = (process.env.HTTPS_PROXY || process.env.ALL_PROXY) ?? "-";
  const socksProxy = process.env.SOCKS_PROXY_HOST && process.env.SOCKS_PROXY_PORT ? `${process.env.SOCKS_PROXY_HOST}:${process.env.SOCKS_PROXY_PORT}` : "-";
  return sendResponse({
    type: "Success",
    data: { apiModel, reverseProxy, timeoutMs, socksProxy, httpsProxy, usage }
  });
}
function setupProxy(options) {
  if (isNotEmptyString(process.env.SOCKS_PROXY_HOST) && isNotEmptyString(process.env.SOCKS_PROXY_PORT)) {
    const agent = new SocksProxyAgent({
      hostname: process.env.SOCKS_PROXY_HOST,
      port: process.env.SOCKS_PROXY_PORT,
      userId: isNotEmptyString(process.env.SOCKS_PROXY_USERNAME) ? process.env.SOCKS_PROXY_USERNAME : void 0,
      password: isNotEmptyString(process.env.SOCKS_PROXY_PASSWORD) ? process.env.SOCKS_PROXY_PASSWORD : void 0
    });
    options.fetch = (url, options2) => {
      return fetch(url, { agent, ...options2 });
    };
  } else if (isNotEmptyString(process.env.HTTPS_PROXY) || isNotEmptyString(process.env.ALL_PROXY)) {
    const httpsProxy = process.env.HTTPS_PROXY || process.env.ALL_PROXY;
    if (httpsProxy) {
      const agent = new HttpsProxyAgent(httpsProxy);
      options.fetch = (url, options2) => {
        return fetch(url, { agent, ...options2 });
      };
    }
  } else {
    options.fetch = (url, options2) => {
      return fetch(url, { ...options2 });
    };
  }
}
function currentModel() {
  return apiModel;
}

// src/middleware/auth.ts
var auth = async (req, res, next) => {
  const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY;
  if (isNotEmptyString(AUTH_SECRET_KEY)) {
    try {
      const Authorization = req.header("Authorization");
      if (!Authorization || Authorization.replace("Bearer ", "").trim() !== AUTH_SECRET_KEY.trim())
        throw new Error("Error: \u65E0\u8BBF\u95EE\u6743\u9650 | No access rights");
      next();
    } catch (error) {
      res.send({ status: "Unauthorized", message: error.message ?? "Please authenticate.", data: null });
    }
  } else {
    next();
  }
};

// src/middleware/limiter.ts
import { rateLimit } from "express-rate-limit";
import {Counter, init as initDB} from "../db.js";
import path from "path";
var MAX_REQUEST_PER_HOUR = process.env.MAX_REQUEST_PER_HOUR;
var maxCount = isNotEmptyString(MAX_REQUEST_PER_HOUR) && !isNaN(Number(MAX_REQUEST_PER_HOUR)) ? parseInt(MAX_REQUEST_PER_HOUR) : 0;
var limiter = rateLimit({
  windowMs: 60 * 60 * 1e3,
  // Maximum number of accesses within an hour
  max: maxCount,
  statusCode: 200,
  // 200 means success，but the message is 'Too many request from this IP in 1 hour'
  message: async (req, res) => {
    res.send({ status: "Fail", message: "Too many request from this IP in 1 hour", data: null });
  }
});

// src/index.ts
var app = express();
var router = express.Router();
app.use(express.static("public"));
app.use(express.json());
app.all("*", (_, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "authorization, Content-Type");
  res.header("Access-Control-Allow-Methods", "*");
  next();
});
router.post("/chat-process", [auth, limiter], async (req, res) => {
  res.setHeader("Content-type", "application/octet-stream");
  try {
    const { prompt, options = {}, systemMessage, temperature, top_p } = req.body;
    let firstChunk = true;
    await chatReplyProcess({
      message: prompt,
      lastContext: options,
      process: (chat) => {
        res.write(firstChunk ? JSON.stringify(chat) : `
${JSON.stringify(chat)}`);
        firstChunk = false;
      },
      systemMessage,
      temperature,
      top_p
    });
  } catch (error) {
    res.write(JSON.stringify(error));
  } finally {
    res.end();
  }
});
router.post("/config", auth, async (req, res) => {
  try {
    const response = await chatConfig();
    res.send(response);
  } catch (error) {
    res.send(error);
  }
});
router.post("/session", async (req, res) => {
  try {
    const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY;
    const hasAuth = isNotEmptyString(AUTH_SECRET_KEY);
    res.send({ status: "Success", message: "", data: { auth: hasAuth, model: currentModel() } });
  } catch (error) {
    res.send({ status: "Fail", message: error.message, data: null });
  }
});
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token)
      throw new Error("Secret key is empty");
    if (process.env.AUTH_SECRET_KEY !== token)
      throw new Error("\u5BC6\u94A5\u65E0\u6548 | Secret key is invalid");
    res.send({ status: "Success", message: "Verify successfully", data: null });
  } catch (error) {
    res.send({ status: "Fail", message: error.message, data: null });
  }
});
app.use("", router);
app.use("/api", router);
app.set("trust proxy", 1);

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => globalThis.console.log("Server is running on port", port));
}

bootstrap();
//# sourceMappingURL=index.mjs.map