import axios from "axios"
import { createClient } from "@supabase/supabase-js"
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase"
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf"
import { testVectorStore } from "./vectorStore"

const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY;
const HUGGINGFACE_API_KEY = process.env.EXPO_PUBLIC_HUGGINGFACE_API_KEY;

// Supabase configuration
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!GROQ_API_KEY) {
  throw new Error('Missing EXPO_PUBLIC_GROQ_API_KEY environment variable');
}

if (!HUGGINGFACE_API_KEY) {
  throw new Error('Missing EXPO_PUBLIC_HUGGINGFACE_API_KEY environment variable');
}

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey)

const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2" // 384 dimensions
const EXPECTED_DIMENSIONS = 384

let embeddings: HuggingFaceInferenceEmbeddings
let vectorStorePromise: Promise<SupabaseVectorStore> | null = null

// Interfaces
interface HistoricalData {
  year: string
  price: number
  currency: string
}

interface SimilarProduct {
  hsn_code: string
  product_name: string
  similarity: number
  countries: string[]
}

interface SimilarHistoricalData {
  hsn_code: string
  product_name: string
  similarity: number
  countries: string[]
  historicalData: HistoricalData[]
}

// Initialize embeddings
async function initializeEmbeddings(): Promise<HuggingFaceInferenceEmbeddings> {
  try {
    const testEmbeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: HUGGINGFACE_API_KEY,
      model: EMBEDDING_MODEL,
    })

    const testVector = await testEmbeddings.embedQuery("test")

    if (testVector.length !== EXPECTED_DIMENSIONS) {
      throw new Error(`Model generates ${testVector.length} dimensions, expected ${EXPECTED_DIMENSIONS}`)
    }

    return testEmbeddings
  } catch (error) {
    throw new Error(`Failed to initialize embedding model: ${error}`)
  }
}

// Get or create vector store instance
async function getVectorStore(): Promise<SupabaseVectorStore> {
  if (!vectorStorePromise) {
    try {
      if (!embeddings) {
        embeddings = await initializeEmbeddings()
      }

      vectorStorePromise = SupabaseVectorStore.fromExistingIndex(embeddings, {
        client: supabase,
        tableName: "documents",
        queryName: "match_documents",
      })

    } catch (error) {
      vectorStorePromise = null
      throw error
    }
  }

  return vectorStorePromise
}

// Simple and reliable embedding generation with dimension validation
export const generateEmbedding = async (text: string, retries = 3): Promise<number[]> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!embeddings) {
        embeddings = await initializeEmbeddings()
      }

      const embedding = await embeddings.embedQuery(text)

      // Validate dimensions
      if (embedding.length !== EXPECTED_DIMENSIONS) {
        throw new Error(`Generated embedding has ${embedding.length} dimensions, expected ${EXPECTED_DIMENSIONS}`)
      }

      return embedding
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`Failed to generate embedding after ${retries} attempts: ${error}`)
      }
      const waitTime = Math.pow(2, attempt) * 1000
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }
  throw new Error("Failed to generate embedding")
}

export const storeProductWithHistoricalData = async (
  productName: string,
  hsnCode: string,
  country: string,
  historicalData: HistoricalData[],
): Promise<void> => {
  try {

    if (!historicalData || historicalData.length === 0) {
      return
    }

    // Format historical data for embedding
    const dataString = historicalData.map((d) => `${d.year}: $${d.price.toFixed(2)} ${d.currency}`).join("\n")

    const text = `Product: ${productName}\nHSN: ${hsnCode}\nCountry: ${country}\nHistorical Data:\n${dataString}`

    // Generate embedding
    const embedding = await generateEmbedding(text)

    const { data: existing, error: fetchError } = await supabase
      .from("documents")
      .select("id")
      .eq("hsn_code", hsnCode)
      .eq("country", country)
      .single()

    if (fetchError && fetchError.code !== "PGRST116") {
      throw new Error(`Error checking existing document: ${fetchError.message}`)
    }

    const metadata = {
      hsn_code: hsnCode,
      name: productName,
      country: country,
      type: "product_with_history",
      // Product metadata
      description: `Historical prices for ${productName} in ${country}`,
      // Historical data metadata
      years: historicalData.map((d) => d.year),
      prices: Object.fromEntries(historicalData.map((d) => [d.year, d.price])),
      currencies: Object.fromEntries(historicalData.map((d) => [d.year, d.currency])),
      created_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("documents")
        .update({
          content: text,
          embedding,
          metadata: {
            ...metadata,
            updated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)

      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabase.from("documents").insert({
        content: text,
        embedding,
        hsn_code: hsnCode,
        country: country,
        metadata,
        created_at: new Date().toISOString(),
      })

      if (insertError) throw insertError
    }

  } catch (error) {
    throw new Error('Error updating record : ', {cause: error})
  }
}

// Fetch historical data from Supabase
export const fetchHistoricalData = async (hsnCode: string, country: string): Promise<HistoricalData[]> => {
  try {

    const { data, error } = await supabase
      .from("market_prices")
      .select("*")
      .eq("hsn_code", Number.parseInt(hsnCode))
      .single()

    if (error) {
      throw new Error(`Database error: ${error.message}`)
    }

    if (!data) {
      throw new Error(`No data found for HSN code: ${hsnCode}`)
    }

    const countryData = data[country]
    if (!countryData) {
      const availableCountries = Object.keys(data).filter(
        (key) =>
          key !== "hsn_code" && key !== "id" && key !== "created_at" && key !== "updated_at" && data[key] !== null,
      )

      if (availableCountries.length === 0) {
        throw new Error(`No data available for any country with HSN code: ${hsnCode}`)
      }

      throw new Error(`No data found for country: ${country}. Available countries: ${availableCountries.join(", ")}`)
    }

    const parsedData = parseCountryData(countryData)
    if (parsedData.length === 0) {
      throw new Error(`No valid historical data found for ${country} with HSN code: ${hsnCode}`)
    }

    return parsedData
  } catch (error) {
    throw new Error('Error fetching historical data : ', { cause: error });
  }
}

// Helper function to parse country JSON data
const parseCountryData = (countryData: any): HistoricalData[] => {
  try {
    let parsedData
    if (typeof countryData === "string") {
      parsedData = JSON.parse(countryData)
    } else if (typeof countryData === "object" && countryData !== null) {
      parsedData = countryData
    } else {
      throw new Error("Invalid data format")
    }

    const historicalPrices = Object.entries(parsedData).map(([year, price]) => ({
      year: year,
      price: Number.parseFloat(price as string),
      currency: "USD",
    }))

    const validData = historicalPrices
      .filter((item) => !isNaN(item.price) && item.price > 0)
      .sort((a, b) => Number.parseInt(b.year.split("-")[0]) - Number.parseInt(a.year.split("-")[0]))
      .slice(0, 5)

    return validData
  } catch (parseError) {
    throw new Error(`Failed to parse data for country: ${parseError}`)
  }
}

// Get available countries
export const getAvailableCountries = async (hsnCode: string): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from("market_prices")
      .select("*")
      .eq("hsn_code", Number.parseInt(hsnCode))
      .single()

    if (error || !data) {
      return []
    }

    const availableCountries = Object.keys(data).filter(
      (key) =>
        key !== "hsn_code" &&
        key !== "id" &&
        key !== "created_at" &&
        key !== "updated_at" &&
        data[key] !== null &&
        data[key] !== undefined,
    )

    return availableCountries
  } catch (error) {
    return []
  }
}

// Initialize product embedding
export const initializeProductEmbedding = async (
  productName: string,
  hsnCode: string,
  country = "AUSTRALIA",
): Promise<void> => {}

// Find similar historical data
export const findSimilarHistoricalData = async (
  productName: string,
  hsnCode: string,
  country: string,
  historicalData: HistoricalData[],
  limit = 5,
): Promise<{
  similarProducts: SimilarProduct[]
  similarHistoricalData: SimilarHistoricalData[]
}> => {
  try {
    // Store the current product's data
    await storeProductWithHistoricalData(productName, hsnCode, country, historicalData)

    // Format query for similarity search
    const dataString = historicalData.map((d) => `${d.year}: $${d.price.toFixed(2)} ${d.currency}`).join("\n")
    const query = `Product: ${productName}\nHSN: ${hsnCode}\nCountry: ${country}\nHistorical Data:\n${dataString}`

    // Generate embedding
    const queryEmbedding = await generateEmbedding(query)

    // Search for similar products and historical data
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: limit * 2,
    })

    if (error) {
      return { similarProducts: [], similarHistoricalData: [] }
    }

    if (!data || data.length === 0) {
      return { similarProducts: [], similarHistoricalData: [] }
    }

    // Process results
    const similarProducts: SimilarProduct[] = []
    const similarHistoricalData: SimilarHistoricalData[] = []

    for (const item of data) {
      if (item.hsn_code === hsnCode && item.country === country) continue // Skip same product

      const similarity = item.similarity * 100

      if (item.metadata?.type === "product_with_history" && similarity >= 50) {
        // Add to similar products
        similarProducts.push({
          hsn_code: item.hsn_code || "Unknown",
          product_name: item.metadata?.name || "Unknown Product",
          similarity: Math.min(100, similarity),
          countries: [item.country || "Unknown"],
        })

        // Also add to similar historical data if it has price data
        if (item.metadata?.years && item.metadata?.prices) {
          const years = item.metadata.years || []
          const prices = item.metadata.prices || {}
          const currencies = item.metadata.currencies || {}

          const docHistoricalData: HistoricalData[] = years.map((year: string) => ({
            year,
            price: prices[year] || 0,
            currency: currencies[year] || "USD",
          }))

          similarHistoricalData.push({
            hsn_code: item.hsn_code || "Unknown",
            product_name: item.metadata?.name || "Unknown Product",
            similarity: Math.min(100, similarity),
            countries: [item.country || "Unknown"],
            historicalData: docHistoricalData,
          })
        }
      }
    }

    return {
      similarProducts: similarProducts.slice(0, limit),
      similarHistoricalData: similarHistoricalData.slice(0, limit),
    }
  } catch (error) {
    return {
      similarProducts: [],
      similarHistoricalData: [],
    }
  }
}

// Enhanced analysis with context
export const analyzeWithEnhancedContext = async (
  historicalData: HistoricalData[],
  productName: string,
  country: string,
  hsnCode: string,
  similarResults: {
    similarProducts: SimilarProduct[]
    similarHistoricalData: SimilarHistoricalData[]
  },
) => {
  try {
    const dataString = historicalData.map((d) => `${d.year}: $${d.price.toFixed(2)} ${d.currency}`).join("\n")

    const similarProductsString =
      similarResults.similarProducts.length > 0
        ? similarResults.similarProducts
            .map((p) => `- ${p.product_name} (HSN: ${p.hsn_code}) - Similarity: ${p.similarity.toFixed(1)}%`)
            .join("\n")
        : "No similar products found"

    const similarHistoricalString =
      similarResults.similarHistoricalData.length > 0
        ? similarResults.similarHistoricalData
            .map((p) => {
              const historyString = p.historicalData
                .map((d) => `${d.year}: $${d.price.toFixed(2)} ${d.currency}`)
                .join(", ")
              return `- ${p.product_name} (HSN: ${p.hsn_code}) - Similarity: ${p.similarity.toFixed(1)}%\n  Prices: ${historyString}`
            })
            .join("\n")
        : "No similar historical data found"

    const prompt = `You are an expert market analyst specializing in international trade and pricing. Analyze the following data:

    PRODUCT DETAILS:
    - Product: ${productName}
    - HSN Code: ${hsnCode}
    - Destination Market: ${country}

    HISTORICAL PRICE DATA:
    ${dataString}

    SIMILAR PRODUCTS:
    ${similarProductsString}

    SIMILAR HISTORICAL DATA:
    ${similarHistoricalString}

    Provide a comprehensive analysis including:
    1. 💰 CURRENT SELLING PRICE: Most recent market price with confidence level
    2. 📈 PRICE TREND ANALYSIS: Direction, percentage changes, volatility patterns
    3. 🌍 MARKET INSIGHTS: Market positioning, demand factors, competition
    4. 🔗 SIMILAR PRODUCTS ANALYSIS: How similar products perform, cross-selling opportunities
    5. 📊 HISTORICAL COMPARISON: Compare with similar historical data patterns
    6. 🔮 FUTURE OUTLOOK: 6-12 month predictions with risk assessment
    7. 💡 BUSINESS RECOMMENDATIONS: Optimal timing, pricing strategies, market entry advice

    Format professionally with clear sections and actionable insights.`

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        messages: [
          {
            role: "system",
            content:
              "You are a professional market analyst with expertise in international trade, pricing trends, and market forecasting. Provide actionable insights with confidence levels.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        model: "llama3-70b-8192",
        temperature: 0.3,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    )

    return {
      result: response.data.choices[0]?.message?.content || "No response",
    }
  } catch (error) {
    throw new Error("Failed to analyze with Groq", {cause:error})
  }
}

// Generate market prediction
export const generateMarketPrediction = async (
  historicalData: HistoricalData[],
  productName: string,
  country: string,
  similarProducts?: SimilarProduct[],
) => {
  try {
    const dataString = historicalData.map((d) => `${d.year}: $${d.price.toFixed(2)}`).join(", ")
    const similarContext =
      similarProducts && similarProducts.length > 0
        ? `Similar products: ${similarProducts.map((p) => p.product_name).join(", ")}`
        : ""

    const prompt = `Based on historical data for ${productName} in ${country}: ${dataString}

    ${similarContext}

    Provide a concise market prediction:
    1. Predicted price for next year
    2. Confidence level (High/Medium/Low)
    3. Key influencing factors
    4. Similar product opportunities
    5. One-line recommendation

    Keep under 250 words, business-focused.`

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        messages: [{ role: "user", content: prompt }],
        model: "llama3-70b-8192",
        temperature: 0.2,
        max_tokens: 400,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    )

    return {
      result: response.data.choices[0]?.message?.content || "No prediction available",
    }
  } catch (error) {
    throw new Error("Failed to generate prediction", {cause: error})
  }
}

// Test connections with schema validation
export const testConnections = async (): Promise<{
  groq: boolean
  vectorStore: boolean
  huggingface: boolean
  langchain: boolean
}> => {
  const results = { groq: false, vectorStore: false, huggingface: false, langchain: false }

  // Test Groq
  try {
    await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        messages: [{ role: "user", content: "Hello" }],
        model: "llama3-70b-8192",
        max_tokens: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    )
    results.groq = true
  } catch (error) {
    throw new Error('Groq connection failed : ', { cause: error });
  }

  // Test existing Vector Store
  try {
    results.vectorStore = await testVectorStore()
  } catch (error) {
    throw new Error('Vector store test failed : ', { cause: error });
  }

  // Test LangChain Vector Store
  try {
    const vectorStore = await getVectorStore()
    await vectorStore.similaritySearch("test query", 1)
    results.langchain = true
  } catch (error) {
    throw new Error("LangChain vector store test failed:", {cause: error})
  }

  // Test HuggingFace via LangChain
  try {
    await generateEmbedding("test")
    results.huggingface = true
  } catch (error) {
    throw new Error("HuggingFace connection failed : ", {cause: error})
  }

  return results
}