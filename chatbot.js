/* API key import */
import { config } from "dotenv";
config();

/* LangChain import */
import { ChatOpenAI } from "langchain/chat_models/openai"
import { ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { ConversationChain } from "langchain/chains";

/* Short Term memory import */
import { BufferMemory, ChatMessageHistory, CombinedMemory} from "langchain/memory";

/* Long Term memory (vector store) import */
// Document loaders 
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { TextLoader } from "langchain/document_loaders/fs/text";
// Vector store loaders
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { HNSWLib } from "langchain/vectorstores/hnswlib";
import { VectorStoreRetrieverMemory } from "langchain/memory";

// File system operations
import fs  from "fs";

/* Token Counting API */
import { Tiktoken } from "@dqbd/tiktoken/lite";
import { load } from "@dqbd/tiktoken/load";
import registry from "@dqbd/tiktoken/registry.json" assert { type: "json" };
import models from "@dqbd/tiktoken/model_to_encoding.json" assert { type: "json" };
import exp from "constants";

// Instantiate llm
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    n: 1,
    maxTokens: 256
});

// Load files 
const documentLoader = new DirectoryLoader("./Documents", {
    ".pdf": (path) => new PDFLoader(path),
    ".txt": (path) => new TextLoader(path),
})

console.log("Loading documents.");
const documentMemory = await documentLoader.load();
console.log("Documents loaded.");

// Calculate embedding cost 
const embeddingCost = await calculateEmbeddingCost(documentMemory);

// Vector Store
const vectorStoreLocation = "VectorStore";
let vectorStore;
console.log("Calculating price of embedding...");
// Embed documents if cost is not insane 
if (embeddingCost <= 0.5){
    console.log(`Embedding request passed, cost ${embeddingCost}`);
    // Check if vector store exists
    if (fs.existsSync(vectorStoreLocation)){
        // Load existing vector store
        console.log("Loading vector store");
        vectorStore = await HNSWLib.load(
            vectorStoreLocation,
            new OpenAIEmbeddings({
                openAIApiKey: process.env.OPENAI_API_KEY,
            })
        );
        console.log("Vector store loaded");
    } else {
        // Create new vector store
        console.log("Creating new vector store...");
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
        });
        const normalizedDocs = normalizeDocuments(documentMemory);
        const splitDocs = await textSplitter.createDocuments(normalizedDocs);

        // Create vector store
        vectorStore = await HNSWLib.fromDocuments(
            splitDocs,
            new OpenAIEmbeddings({
                openAIApiKey: process.env.OPENAI_API_KEY,
            })        
        );
        // Save to vector store path
        await vectorStore.save(vectorStoreLocation);

        console.log("Vector store created.");
    }
} else {
    console.log("Embedding cost exceeds $0.5, Long Term Memory instantiation aborted.");
}

/* Produce llmChain */
// Long term memory 
const longTermMemory = new VectorStoreRetrieverMemory({
    vectorStoreRetriever: vectorStore.asRetriever(2),
    memoryKey: "LongTermMemory",
    inputKey: "input"
})

// Chat box prompt
const chatPrompt = ChatPromptTemplate.fromPromptMessages([
    SystemMessagePromptTemplate.fromTemplate("You must pretend to be Alvin Karanja when answering questions, refer to yourself in first person. Use respectful and formal language, If a user asks an unanswerable question politely instruct them to (view the attached CV). If the user starts to ask non personal/general questions not about Alvin, remind them you are a representation of Alvin created with the purpose of answering questions about him."),
    SystemMessagePromptTemplate.fromTemplate("If a user provides information about themselves, remember it."),
    SystemMessagePromptTemplate.fromTemplate("You should answer all human questions with the following information as context: {LongTermMemory}, assumptions about Alvin's character can be made to answer general questions about him."),
    new MessagesPlaceholder("ShortTermMemory"),
    HumanMessagePromptTemplate.fromTemplate("{input}")
])

// Calculate cost of embedding call
async function calculateEmbeddingCost(documents) {
    const modelName = "text-embedding-ada-002";
    const modelKey = models[modelName];
    const model = await load(registry[modelKey]);
    const encoder = new Tiktoken(
      model.bpe_ranks,
      model.special_tokens,
      model.pat_str
    );
    const tokens = encoder.encode(JSON.stringify(documents));
    const tokenCount = tokens.length;
    const ratePerThousandTokens = 0.0004;
    const cost = (tokenCount / 1000) * ratePerThousandTokens;
    encoder.free();
    return cost;
}

// Format document
function normalizeDocuments(documents) {
    return documents.map((documents) => {
      if (typeof documents.pageContent === "string") {
        return documents.pageContent;
      } else if (Array.isArray(documents.pageContent)) {
        return documents.pageContent.join("\n");
      }
    });
}

// Conversation database across users
const conversationDatabase = {};
export async function chatBotInterface (input, conversationId) {

    const stringID = conversationId.toString();
    // Generate short term memory for different users
    let shortTermMemory
    if(!conversationDatabase.hasOwnProperty(stringID)){
    // Short term memory
    shortTermMemory =  new BufferMemory({
        returnMessages: true, 
        memoryKey: "ShortTermMemory", 
        inputKey: "input",
        chatHistory: new ChatMessageHistory()
    })
    conversationDatabase[stringID] = shortTermMemory
    }else{
        shortTermMemory = conversationDatabase[stringID];
        console.log(conversationDatabase[stringID]);
    }

    // Combined memory
    const modelMemory = new CombinedMemory({
        memories: [shortTermMemory, longTermMemory]
    })
    // Create llmChain
    const llmChain = new ConversationChain({
        llm: llm, 
        prompt: chatPrompt,
        memory: modelMemory,
        // verbose: true // setting this shows message log
    })
    let response = await llmChain.call({input: input});
    return response;
};

export function clearSessionFromDataBase(conversationId){
    const stringID = conversationId.toString();
    if (conversationDatabase.hasOwnProperty(stringID)){
        console.log(`Deleting short term memory for index: ${stringID}`);
        delete conversationDatabase[stringID];
        return true;
    }

    return false;
}

export function currentConversations(){
    console.log(conversationDatabase);
}

export function existsInSTM(conversationId){
    if(conversationDatabase.hasOwnProperty(conversationId)){
        return true;
    }
    return false;
}