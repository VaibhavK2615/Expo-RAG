import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Switch,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  analyzeWithEnhancedContext,
  generateMarketPrediction,
  findSimilarHistoricalData,
  initializeProductEmbedding,
  testConnections,
  fetchHistoricalData,
  getAvailableCountries
} from '../../lib/api';

interface HistoricalData {
  year: string;
  price: number;
  currency: string;
}

interface SimilarProduct {
  hsn_code: string;
  product_name: string;
  similarity: number;
  countries: string[];
}

interface SimilarHistoricalData {
  hsn_code: string;
  product_name: string;
  similarity: number;
  countries: string[];
  historicalData: HistoricalData[];
}

export default function PriceAnalyzerScreen() {
  const [product, setProduct] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [country, setCountry] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSimilar, setIsLoadingSimilar] = useState(false);
  const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
  const [useAI, setUseAI] = useState(true);
  const [prediction, setPrediction] = useState('');
  const [similarProducts, setSimilarProducts] = useState<SimilarProduct[]>([]);
  const [similarHistoricalData, setSimilarHistoricalData] = useState<SimilarHistoricalData[]>([]);
  const [useEmbeddings, setUseEmbeddings] = useState(true);
  const [isTesting, setIsTesting] = useState(false);

  const productRef = useRef<TextInput>(null);
  const countryRef = useRef<TextInput>(null);
  const hsnRef = useRef<TextInput>(null);

  useEffect(() => {
    // Force reset all loading states
    setIsLoading(false);
    setIsLoadingSimilar(false);
    setIsTesting(false);
  }, []);

  const analyzeLocalData = (
    data: HistoricalData[],
    productName: string,
    countryName: string,
    hsnCode: string,
    similarProducts?: SimilarProduct[]
  ) => {
    if (data.length === 0) {
      return "No historical data available for analysis.";
    }

    const prices = data.map(d => d.price);
    const currentSellingPrice = prices[0];
    const previousPrice = prices.length > 1 ? prices[1] : prices[0];
    const minHistoricalPrice = Math.min(...prices);
    const maxHistoricalPrice = Math.max(...prices);

    let trend = 'stable';
    let recentChange = 0;

    if (prices.length > 1) {
      recentChange = ((currentSellingPrice - previousPrice) / previousPrice) * 100;
      if (recentChange > 2) trend = 'increasing';
      else if (recentChange < -2) trend = 'decreasing';
    }

    const currentYear = data[0].year;
    const similarProductsSection = similarProducts && similarProducts.length > 0
      ? `\n🔗 SIMILAR PRODUCTS FOUND:\n${similarProducts.map(p =>
        `• ${p.product_name} (${p.hsn_code}) - ${p.similarity.toFixed(1)}% similar`
      ).join('\n')}\n`
      : '\n🔍 No similar products found\n';

    const analysis = `🎯 ENHANCED PRICE ANALYSIS

    📦 Product: ${productName}
    🏷️ HSN Code: ${hsnCode}
    🌍 Market: ${countryName}

    💰 CURRENT SELLING PRICE: $${currentSellingPrice.toFixed(2)} USD (${currentYear})

    📊 KEY METRICS:
    • Current Price: $${currentSellingPrice.toFixed(2)} USD
    • Recent Trend: ${trend.toUpperCase()}${prices.length > 1 ? `\n• Recent Change: ${recentChange > 0 ? '+' : ''}${recentChange.toFixed(1)}%` : ''}
    • Historical Range: $${minHistoricalPrice.toFixed(2)} - $${maxHistoricalPrice.toFixed(2)} USD

    📈 MARKET POSITION:
    ${currentSellingPrice === maxHistoricalPrice ? '🔥 At HIGHEST historical price' :
            currentSellingPrice === minHistoricalPrice ? '💎 At LOWEST historical price' :
              currentSellingPrice > (minHistoricalPrice + maxHistoricalPrice) / 2 ? '📈 Above historical average' :
                '📉 Below historical average'}

    ${similarProductsSection}

    💡 RECOMMENDATION:
    ${trend === 'increasing' ? '⚠️ Prices trending UP - Consider timing' :
            trend === 'decreasing' ? '✅ Prices trending DOWN - Good opportunity' :
              '➡️ Stable pricing - Predictable conditions'}

    📅 Analysis based on ${data.length} data points`;

    return analysis.trim();
  };

  const handleAnalyze = async () => {
    if (!product.trim() || !country.trim() || !hsnCode.trim()) {
      Alert.alert('Missing Information', 'Please fill in all fields before analyzing');
      return;
    }

    setIsLoading(true);
    setIsLoadingSimilar(false);
    setResult('');
    setPrediction('');
    setHistoricalData([]);
    setSimilarProducts([]);
    setSimilarHistoricalData([]);

    try {
      if (useEmbeddings) {
        initializeProductEmbedding(product.trim(), hsnCode.trim(), country.trim().toUpperCase());
      }

      // Fetch historical data
      let data: HistoricalData[] = [];
      try {
        data = await fetchHistoricalData(hsnCode.trim(), country.trim().toUpperCase());
        setHistoricalData(data);
      } catch (dataError) {
        // Handle the error but ensure we reset loading states
        try {
          const availableCountries = await getAvailableCountries(hsnCode.trim());
          if (availableCountries.length > 0) {
            Alert.alert(
              'No Data Found',
              `No historical data found for:\n• Product: ${product}\n• HSN Code: ${hsnCode}\n• Country: ${country.toUpperCase()}\n\nAvailable countries for HSN ${hsnCode}:\n${availableCountries.join(', ')}\n\nPlease try one of these countries.`,
              [
                {
                  text: 'OK',
                  onPress: () => {
                    if (availableCountries.length > 0) {
                      setCountry(availableCountries[0]);
                    }
                  }
                }
              ]
            );
          } else {
            Alert.alert(
              'No Data Available',
              `No historical data found for HSN code: ${hsnCode}\n\nThis HSN code may not exist in our database or may not have any price data available.`,
              [
                {
                  text: 'OK',
                  onPress: () => {
                    setHsnCode('');
                  }
                }
              ]
            );
          }
        } catch (countriesError) {
          Alert.alert(
            'Data Error',
            `Failed to fetch data:\n${dataError}\n\nPlease check your HSN code and country, then try again.`
          );
        }
        setResult('No historical data available for analysis.');
        return;
      }

      let similarResults = {
        similarProducts: [] as SimilarProduct[],
        similarHistoricalData: [] as SimilarHistoricalData[]
      };

      if (useEmbeddings) {
        try {
          setIsLoadingSimilar(true);
          similarResults = await findSimilarHistoricalData(
            product.trim(),
            hsnCode.trim(),
            country.trim().toUpperCase(),
            data
          );
          setSimilarProducts(similarResults.similarProducts);
          setSimilarHistoricalData(similarResults.similarHistoricalData);
        } catch (similarityError) {
          setSimilarProducts([]);
          setSimilarHistoricalData([]);
        } finally {
          setIsLoadingSimilar(false);
        }
      }

      if (useAI) {
        const aiResult = await analyzeWithEnhancedContext(
          data,
          product.trim(),
          country.trim(),
          hsnCode.trim(),
          similarResults
        );
        setResult(`🤖 AI-POWERED ENHANCED ANALYSIS\n\n${aiResult.result}`);

        try {
          const predictionResult = await generateMarketPrediction(
            data,
            product.trim(),
            country.trim(),
            similarResults.similarProducts
          );
          setPrediction(`🔮 MARKET PREDICTION\n\n${predictionResult.result}`);
        } catch (predError) {
          setPrediction('🔮 Market prediction temporarily unavailable');
        }
      } else {
        const localAnalysis = analyzeLocalData(
          data,
          product.trim(),
          country.trim(),
          hsnCode.trim(),
          similarResults.similarProducts
        );
        setResult(localAnalysis);
      }

    } catch (error) {
      Alert.alert(
        'Analysis Error',
        `Failed to complete analysis:\n${error}\n\nPlease check your inputs and try again.`
      );
      setResult(`Analysis failed: ${error}`);
    } finally {
      setIsLoading(false);
      setIsLoadingSimilar(false);
    }
  };

  const handleButtonPress = () => {
    productRef.current?.blur();
    countryRef.current?.blur();
    hsnRef.current?.blur();
    // Dismiss keyboard
    Keyboard.dismiss();
    setTimeout(() => {
      handleAnalyze();
    }, 150);
  };

  const testAPIs = async () => {
    setIsTesting(true);
    setIsLoading(true);
    try {
      const results = await testConnections();
      Alert.alert(
        'API Connection Test',
        `Groq: ${results.groq ? '✅ Connected' : '❌ Failed'}\nVector Store: ${results.vectorStore ? '✅ Connected' : '❌ Failed'}\nHuggingFace: ${results.huggingface ? '✅ Connected' : '❌ Failed'}\nLangChain: ${results.langchain ? '✅ Connected' : '❌ Failed'}`
      );
    } catch (error) {
      Alert.alert('Test Error', error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
      setIsTesting(false);
    }
  };

  const handleSimilarProductClick = (similarProduct: SimilarProduct) => {
    setProduct(similarProduct.product_name);
    setHsnCode(similarProduct.hsn_code);
    Alert.alert(
      'Product Selected',
      `Selected: ${similarProduct.product_name}\nHSN: ${similarProduct.hsn_code}\n\nPress "Analyze" to get insights for this product.`
    );
  };

  const renderSimilarProducts = () => {
    if (similarProducts.length === 0) {
      return null;
    }

    return (
      <View style={styles.similarContainer}>
        <Text style={styles.similarTitle}>🔗 Similar Products Found</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {similarProducts.map((product, index) => (
            <TouchableOpacity
              key={index}
              style={styles.similarCard}
              onPress={() => handleSimilarProductClick(product)}
            >
              <View style={styles.similarCardContent}>
                <Text style={styles.similarProductName}>{product.product_name}</Text>
                <Text style={styles.similarHsn}>HSN: {product.hsn_code}</Text>
                <Text style={styles.similarSimilarity}>
                  {product.similarity.toFixed(1)}% similar
                </Text>
                <Text style={styles.tapHint}>Tap to select</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderSimilarHistorical = () => {
    if (similarHistoricalData.length === 0) {
      return null;
    }

    return (
      <View style={styles.similarHistoricalContainer}>
        <Text style={styles.similarTitle}>📊 Similar Historical Data</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {similarHistoricalData.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.similarHistoricalCard}
              onPress={() => handleSimilarProductClick(item)}
            >
              <View style={styles.similarCardContent}>
                <Text style={styles.similarProductName}>{item.product_name}</Text>
                <Text style={styles.similarHsn}>HSN: {item.hsn_code}</Text>
                <Text style={styles.similarSimilarity}>
                  {item.similarity.toFixed(1)}% similar
                </Text>
                {item.historicalData.slice(0, 2).map((data, i) => (
                  <Text key={i} style={styles.historicalItem}>
                    {data.year}: ${data.price.toFixed(2)}
                  </Text>
                ))}
                {item.historicalData.length > 2 && (
                  <Text style={styles.moreData}>+{item.historicalData.length - 2} more years</Text>
                )}
                <Text style={styles.tapHint}>Tap to select</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView 
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>🔍 AI Price Analyzer</Text>
            <Text style={styles.subtitle}>
              Enhanced with historical data embeddings and similar product discovery
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.toggleContainer}>
            <Text style={styles.toggleLabel}>
              {useAI ? '🤖 AI Analysis' : '⚡ Local Analysis'}
            </Text>
            <Switch
              value={useAI}
              onValueChange={setUseAI}
              trackColor={{ false: '#D1D5DB', true: '#3B82F6' }}
              thumbColor={useAI ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>

          <View style={styles.toggleContainer}>
            <Text style={styles.toggleLabel}>
              {useEmbeddings ? '🧠 Vector Embeddings' : '🚫 Skip Embeddings'}
            </Text>
            <Switch
              value={useEmbeddings}
              onValueChange={setUseEmbeddings}
              trackColor={{ false: '#D1D5DB', true: '#10B981' }}
              thumbColor={useEmbeddings ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>

          {/* Action Buttons */}
          <View style={{ width: '100%', paddingHorizontal: 16 }}>
            <TouchableOpacity
              style={{
                backgroundColor: '#10B981',
                paddingVertical: 12,
                marginBottom: '5%',
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
              }}
              onPress={testAPIs}
              disabled={isTesting || isLoading}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '500',
                  color: 'white',
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {isTesting ? '🧪 Testing...' : '🧪 Test APIs'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>📦 Product Name</Text>
              <TextInput
                ref={productRef}
                style={styles.input}
                value={product}
                onChangeText={setProduct}
                placeholder="e.g. Ceramic Bricks, Steel Pipes, Cotton Fabric..."
                placeholderTextColor="#9CA3AF"
                returnKeyType="next"
                onSubmitEditing={() => countryRef.current?.focus()}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>🌍 Destination Country</Text>
              <TextInput
                ref={countryRef}
                style={styles.input}
                value={country}
                onChangeText={(text) => setCountry(text.toUpperCase())}
                placeholder="e.g. AUSTRALIA, U_S_A, JAPAN..."
                placeholderTextColor="#9CA3AF"
                autoCapitalize="characters"
                returnKeyType="next"
                onSubmitEditing={() => hsnRef.current?.focus()}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>🏷️ HSN Code</Text>
              <TextInput
                ref={hsnRef}
                style={styles.input}
                value={hsnCode}
                onChangeText={setHsnCode}
                placeholder="e.g. 690100, 730400..."
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, (isLoading || isLoadingSimilar || isTesting) && styles.buttonDisabled]}
              onPress={handleButtonPress}
              disabled={isLoading || isLoadingSimilar || isTesting}
            >
              {isLoading ? (
                <View style={styles.buttonContent}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.buttonText}>
                    {isLoadingSimilar ? 'Finding Similar Products...' :
                      useEmbeddings ? 'Creating Embeddings...' :
                        useAI ? 'AI Analyzing...' : 'Analyzing...'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>
                  {useEmbeddings ? '🧠 Smart Analyze' :
                    useAI ? '🤖 AI Analyze' : '⚡ Quick Analyze'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Similar Products Loading */}
          {isLoadingSimilar && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#6366F1" />
              <Text style={styles.loadingText}>Finding similar products and historical data...</Text>
            </View>
          )}

          {/* Similar Products Section */}
          {!isLoadingSimilar && renderSimilarProducts()}

          {/* Similar Historical Data Section */}
          {!isLoadingSimilar && renderSimilarHistorical()}

          {/* Results */}
          {result && (
            <View style={styles.resultContainer}>
              <Text style={styles.resultTitle}>📊 Analysis Results</Text>
              <ScrollView style={styles.resultScroll} nestedScrollEnabled>
                <Text style={styles.resultText}>{result}</Text>
              </ScrollView>
            </View>
          )}

          {prediction && (
            <View style={styles.predictionContainer}>
              <ScrollView style={styles.resultScroll} nestedScrollEnabled>
                <Text style={styles.resultText}>{prediction}</Text>
              </ScrollView>
            </View>
          )}

          {/* Historical Data Table */}
          {historicalData.length > 0 && (
            <View style={styles.tableContainer}>
              <Text style={styles.tableTitle}>📈 Historical Data</Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={styles.tableHeaderText}>Year</Text>
                  <Text style={styles.tableHeaderText}>Price (USD)</Text>
                </View>
                {historicalData.map((row, index) => (
                  <View key={index} style={[styles.tableRow, index % 2 === 0 && styles.tableRowEven]}>
                    <Text style={styles.tableCellText}>{row.year}</Text>
                    <Text style={styles.tableCellText}>${row.price.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              🧠 Enhanced with historical data embeddings and intelligent similarity matching
            </Text>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16
  },
  header: {
    alignItems: 'center',
    paddingVertical: 32
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151'
  },
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6
  },
  inputGroup: {
    marginBottom: 24
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8
  },
  input: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#FFFFFF'
  },
  button: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4
  },
  buttonDisabled: {
    backgroundColor: '#9CA3AF',
    shadowOpacity: 0
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    marginBottom: 16,
  },
  loadingText: {
    marginLeft: 10,
    color: '#6366F1',
    fontSize: 14,
  },
  similarContainer: {
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#10B981'
  },
  similarHistoricalContainer: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#F59E0B'
  },
  similarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#065F46',
    marginBottom: 16
  },
  similarCard: {
    width: 180,
    marginRight: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  similarHistoricalCard: {
    width: 200,
    marginRight: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  similarCardContent: {
    padding: 16,
  },
  similarProductName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  similarHsn: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  similarSimilarity: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  historicalItem: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 2,
  },
  moreData: {
    fontSize: 10,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  tapHint: {
    fontSize: 10,
    color: '#3B82F6',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  resultContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6
  },
  predictionContainer: {
    backgroundColor: '#F0F9FF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#3B82F6'
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16
  },
  resultScroll: {
    maxHeight: 400
  },
  resultText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 22,
    fontFamily: 'monospace'
  },
  tableContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6
  },
  tableTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16
  },
  table: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    overflow: 'hidden'
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    paddingVertical: 16,
    paddingHorizontal: 16
  },
  tableHeaderText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center'
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB'
  },
  tableRowEven: {
    backgroundColor: '#F9FAFB'
  },
  tableCellText: {
    flex: 1,
    fontSize: 14,
    color: '#1F2937',
    textAlign: 'center'
  },
  footer: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 32
  },
  footerText: {
    fontSize: 13,
    color: '#1E40AF',
    textAlign: 'center',
    lineHeight: 20
  }
});