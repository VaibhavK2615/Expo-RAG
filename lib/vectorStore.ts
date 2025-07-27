import { supabase } from "./supabase"
import { generateEmbedding } from "./api"

export interface VectorSimilarProduct {
  content: string
  metadata: {
    hsn_code: string
    name: string
    country: string
    prices: Record<string, number>
    created_at?: string
    updated_at?: string
    type?: string
  }
  similarity: number
  hsn_code: string
  product_name: string
  countries: string[]
}

// Search similar products
export const searchSimilarProducts = async (
  query: string,
  excludeHsnCode?: string,
  k = 5,
): Promise<VectorSimilarProduct[]> => {
  try {
    const queryEmbedding = await generateEmbedding(query)

    // Use the match_documents procedure
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.1,
      match_count: k + 10,
    })

    if (error) {
      return await searchSimilarProductsSimple(query, excludeHsnCode, k)
    }

    if (!data || data.length === 0) {
      return await searchSimilarProductsSimple(query, excludeHsnCode, k)
    }

    const similarProducts: VectorSimilarProduct[] = data
      .filter((item: any) => {
        // Filter out excluded HSN code
        if (excludeHsnCode && (item.hsn_code === excludeHsnCode || item.metadata?.hsn_code === excludeHsnCode)) {
          return false
        }
        if (item.metadata?.type !== "product_with_history") {
          return false
        }
        return item.similarity >= 0.1
      })
      .slice(0, k)
      .map((item: any) => ({
        content: item.content,
        metadata: item.metadata || {},
        similarity: Math.min(100, item.similarity * 100),
        hsn_code: item.hsn_code || item.metadata?.hsn_code || "Unknown",
        product_name: item.metadata?.name || item.content.split("\n")[0]?.replace("Product: ", "") || "Unknown Product",
        countries: [item.country || item.metadata?.country || "Unknown"],
      }))

    return similarProducts
  } catch (error) {
    return await searchSimilarProductsSimple(query, excludeHsnCode, k)
  }
}

// Simple text-based similarity search as fallback
export const searchSimilarProductsSimple = async (
  query: string,
  excludeHsnCode?: string,
  k = 5,
): Promise<VectorSimilarProduct[]> => {
  try {
    let supabaseQuery = supabase.from("documents").select("*").eq("metadata->>type", "product_with_history").limit(100)

    if (excludeHsnCode) {
      supabaseQuery = supabaseQuery.neq("hsn_code", excludeHsnCode)
    }

    const { data, error } = await supabaseQuery

    if (error || !data) {
      return []
    }

    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2)

    const similarities: VectorSimilarProduct[] = []

    for (const doc of data) {
      const contentWords = doc.content?.toLowerCase().split(/\s+/) || []
      const nameWords = (doc.metadata?.name || "").toLowerCase().split(/\s+/)
      const allWords = [...contentWords, ...nameWords]

      const commonWords = queryWords.filter((queryWord) =>
        allWords.some((docWord) => docWord.includes(queryWord) || queryWord.includes(docWord)),
      )

      const similarity = (commonWords.length / Math.max(queryWords.length, 1)) * 100

      if (similarity > 20) {
        similarities.push({
          content: doc.content || "",
          metadata: doc.metadata || {},
          similarity: similarity,
          hsn_code: doc.hsn_code || doc.metadata?.hsn_code || "Unknown",
          product_name: doc.metadata?.name || "Unknown Product",
          countries: [doc.country || doc.metadata?.country || "Unknown"],
        })
      }
    }

    const results = similarities.sort((a, b) => b.similarity - a.similarity).slice(0, k)
    return results
  } catch (error) {
    return []
  }
}

export const testVectorStore = async (): Promise<boolean> => {
  try {
    // Test basic query
    const { data, error } = await supabase.from("documents").select("id, content, metadata").limit(1)

    if (error) {
      return false
    }

    return true
  } catch (error) {
    return false
  }
}