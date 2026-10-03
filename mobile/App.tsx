import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

type Totals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
};
type Summary = {
  consumed: Totals;
  goals: Totals;
  remaining_calories: number;
  remaining_protein_g: number;
};
type Profile = {
  id: number;
  name: string;
  age: number | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: string;
  goal: string;
  weight_loss_speed: string;
  calorie_goal: number;
  protein_goal: number;
  carb_goal: number;
  fat_goal: number;
  onboarding_complete: boolean;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type MealCandidate = {
  source: "chat" | "decompose";
  description: string;
  mealType: string;
  totals: Totals;
};

type PlannedMeal = {
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  description: string;
  approx_calories: number;
  approx_protein_g: number;
  approx_carbs_g?: number;
  approx_fat_g?: number;
  approx_fiber_g?: number;
  approx_sugar_g?: number;
  approx_sodium_mg?: number;
};

type AIPlan = {
  message: string;
  remaining_calories: number;
  remaining_protein_g: number;
  meals: PlannedMeal[];
};

function localDateKey() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

const emptyTotals: Totals = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync("session_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<"today" | "ai" | "profile">("today");
  const [showAdd, setShowAdd] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meals, setMeals] = useState<any[]>([]);
  const [mealText, setMealText] = useState("");
  const [mealType, setMealType] = useState("meal");
  const [analysis, setAnalysis] = useState<any>(null);
  const [mealAnalyzeLoading, setMealAnalyzeLoading] = useState(false);

  // Ask AI — real chat state
  const [chatText, setChatText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Meal planner — 3 successful generations per calendar day
  const [planResponse, setPlanResponse] = useState<AIPlan | null>(null);
  const [planCount, setPlanCount] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [planAddLoading, setPlanAddLoading] = useState(false);

  // Food decomposition
  const [foodToDecompose, setFoodToDecompose] = useState("");
  const [decomposeResponse, setDecomposeResponse] = useState("");
  const [suggestedMealDescription, setSuggestedMealDescription] = useState("");
  const [decomposeLoading, setDecomposeLoading] = useState(false);

  // Candidate meal waiting for explicit user confirmation
  const [mealCandidate, setMealCandidate] = useState<MealCandidate | null>(null);

  const [appleAvailable, setAppleAvailable] = useState(false);

  const groupedMeals = useMemo(() => {
    const groups: Record<string, any[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
      meal: [],
    };
    for (const meal of meals) {
      const key = groups[meal.meal_type] ? meal.meal_type : "meal";
      groups[key].push(meal);
    }
    return groups;
  }, [meals]);

  useEffect(() => {
    void bootstrap();
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => {});
  }, []);

  async function bootstrap() {
    try {
      await loadPlanUsage();
      const p = await api<Profile>("/api/profile");
      setProfile(p);
      setOnboarding(!p.onboarding_complete);
      if (p.onboarding_complete) await loadToday();
    } catch {
      setOnboarding(true);
    } finally {
      setBooting(false);
    }
  }

  async function loadPlanUsage() {
    const today = localDateKey();
    const savedDate = await SecureStore.getItemAsync("plan_date");
    const savedCount = await SecureStore.getItemAsync("plan_count");

    if (savedDate !== today) {
      await SecureStore.setItemAsync("plan_date", today);
      await SecureStore.setItemAsync("plan_count", "0");
      setPlanCount(0);
      return;
    }

    setPlanCount(Math.min(Number(savedCount || "0"), 3));
  }
  async function loadToday() {
    const [s, m] = await Promise.all([
      api<Summary>("/api/summary"),
      api<any[]>("/api/meals"),
    ]);
    setSummary(s);
    setMeals(m);
  }
  async function signInApple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken)
        throw new Error("Apple did not return an identity token.");
      const name = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(" ")
        : undefined;
      const result = await api<{ access_token: string; user: Profile }>(
        "/api/auth/apple",
        {
          method: "POST",
          body: JSON.stringify({
            identity_token: credential.identityToken,
            authorization_code: credential.authorizationCode,
            email: credential.email,
            name,
          }),
        },
      );
      await SecureStore.setItemAsync("session_token", result.access_token);
      setProfile(result.user);
      setOnboarding(!result.user.onboarding_complete);
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED")
        Alert.alert("Apple Sign In", e?.message || "Sign in failed.");
    }
  }
  async function saveOnboarding(data: any) {
    try {
      const p = await api<Profile>("/api/onboarding", {
        method: "POST",
        body: JSON.stringify(data),
      });
      setProfile(p);
      setOnboarding(false);
      await loadToday();
    } catch (e: any) {
      Alert.alert("Profile setup failed", e?.message || "Please try again.");
    }
  }
  async function analyze() {
    const description = mealText.trim();
    if (!description || mealAnalyzeLoading) return;
    setMealAnalyzeLoading(true);
    try {
      setAnalysis(
        await api("/api/meals/analyze", {
          method: "POST",
          body: JSON.stringify({ description, meal_type: mealType }),
        }),
      );
    } catch (e: any) {
      Alert.alert("Analysis failed", e?.message || "");
    } finally {
      setMealAnalyzeLoading(false);
    }
  }
  async function saveMeal() {
    if (!mealText.trim()) return;
    try {
      await api("/api/meals", {
        method: "POST",
        body: JSON.stringify({ description: mealText, meal_type: mealType }),
      });
      setMealText("");
      setAnalysis(null);
      await loadToday();
      setTab("today");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || "");
    }
  }
  function addUserMessage(content: string) {
    setChatMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: "user", content },
    ]);
  }

  function looksLikeMealStatement(message: string) {
    return /\b(i\s+(?:ate|had)|today\s+i\s+(?:ate|had))\b/i.test(message);
  }

  function inferMealType(message?: string) {
    const explicit = message?.match(/\b(breakfast|lunch|dinner|snack)\b/i)?.[1]?.toLowerCase();
    if (explicit === "breakfast" || explicit === "lunch" || explicit === "dinner" || explicit === "snack") {
      return explicit;
    }
    const hour = new Date().getHours();
    if (hour < 11) return "breakfast";
    if (hour < 16) return "lunch";
    if (hour < 21) return "dinner";
    return "snack";
  }

  function extractFoodFromStatement(message: string) {
    const cleaned = message
      .replace(/^\s*(today\s+)?i\s+(ate|had)\s+/i, "")
      .replace(/\s+today\s*$/i, "")
      .trim();
    return cleaned || message;
  }

  async function prepareMealCandidate(food: string, source: MealCandidate["source"], explicitMealType?: string) {
    const decompose = await api<{
      message: string;
      suggested_description: string;
    }>("/api/ai/decompose", {
      method: "POST",
      body: JSON.stringify({ food }),
    });

    const analyzed = await api<any>("/api/meals/analyze", {
      method: "POST",
      body: JSON.stringify({
        description: decompose.suggested_description,
        meal_type: "meal",
      }),
    });

    setMealCandidate({
      source,
      description: decompose.suggested_description,
      mealType: explicitMealType || inferMealType(food),
      totals: analyzed.totals,
    });

    return decompose;
  }

  async function sendChat() {
    const message = chatText.trim();
    if (!message || chatLoading) return;

    // Clear immediately so the message behaves like a normal chat input.
    setChatText("");
    setChatLoading(true);
    addUserMessage(message);

    try {
      const r = await api<{ message: string }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message }),
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: r.message,
        },
      ]);

      // MVP intent: if the user says they ate/had something, prepare a
      // nutrition candidate and ask for confirmation before saving it.
      if (looksLikeMealStatement(message)) {
        try {
          const food = extractFoodFromStatement(message);
          await prepareMealCandidate(food, "chat", inferMealType(message));
        } catch (mealError: any) {
          Alert.alert("Meal analysis failed", mealError?.message || "");
        }
      }
    } catch (e: any) {
      Alert.alert("AI failed", e?.message || "");
    } finally {
      setChatLoading(false);
    }
  }

  async function createPlan() {
    if (planLoading || planAddLoading) return;

    if (planCount >= 3) {
      Alert.alert("Daily limit reached", "You can create up to 3 meal plans per day.");
      return;
    }

    setPlanLoading(true);
    try {
      const r = await api<AIPlan>("/api/ai/meal-plan", {
        method: "POST",
        body: JSON.stringify({
          request:
            "Create a practical plan for the rest of today. Include breakfast, lunch, dinner and snacks when needed. Use my remaining calories, prioritize protein, and keep the total within my remaining calories.",
        }),
      });

      const nextCount = planCount + 1;
      setPlanCount(nextCount);
      await SecureStore.setItemAsync("plan_count", String(nextCount));
      setPlanResponse(r);
    } catch (e: any) {
      Alert.alert("Meal plan failed", e?.message || "");
    } finally {
      setPlanLoading(false);
    }
  }
  async function resetPlanLimit() {
  const today = new Date().toISOString().slice(0, 10);

  await SecureStore.setItemAsync("plan_date", today);
  await SecureStore.setItemAsync("plan_count", "0");

  setPlanCount(0);
  setPlanResponse(null);

  Alert.alert("Reset complete", "AI meal-plan limit is now 3/3.");
}

  function clearPlan() {
    setPlanResponse(null);
  }

  async function addPlanToToday() {
    if (!planResponse || planResponse.meals.length === 0 || planAddLoading) return;

    setPlanAddLoading(true);
    try {
      for (const plannedMeal of planResponse.meals) {
        await api("/api/ai/meal-plan/add", {
          method: "POST",
          body: JSON.stringify({
            ...plannedMeal,
            description: `${plannedMeal.name} — ${plannedMeal.description}`,
          }),
        });
      }

      await loadToday();
      setPlanResponse(null);
      Alert.alert("Plan added", "Breakfast, lunch, dinner and snacks were added to Today by meal type.");
    } catch (e: any) {
      Alert.alert("Could not add plan", e?.message || "");
    } finally {
      setPlanAddLoading(false);
    }
  }

  function clearDecompose() {
    setFoodToDecompose("");
    setDecomposeResponse("");
    setSuggestedMealDescription("");
    if (mealCandidate?.source === "decompose") setMealCandidate(null);
  }

  async function decomposeFood() {
    const food = foodToDecompose.trim();
    if (!food || decomposeLoading) return;

    // Clear the input as soon as it is submitted.
    setFoodToDecompose("");
    setDecomposeLoading(true);
    try {
      const r = await prepareMealCandidate(food, "decompose");
      setDecomposeResponse(r.message);
      setSuggestedMealDescription(r.suggested_description);
    } catch (e: any) {
      Alert.alert("Food analysis failed", e?.message || "");
    } finally {
      setDecomposeLoading(false);
    }
  }

  function clearChat() {
    setChatMessages([]);
    setChatText("");
    if (mealCandidate?.source === "chat") setMealCandidate(null);
  }

  async function addCandidateToToday() {
    if (!mealCandidate) return;

    try {
      await api("/api/meals", {
        method: "POST",
        body: JSON.stringify({
          description: mealCandidate.description,
          meal_type: mealCandidate.mealType,
        }),
      });

      setMealCandidate(null);
      await loadToday();
      Alert.alert("Added to Today", "Your meal was added to today's diary.");
    } catch (e: any) {
      Alert.alert("Could not add meal", e?.message || "");
    }
  }

  function dismissMealCandidate() {
    setMealCandidate(null);
  }

  function confirmDeleteMeal(meal: any) {
    Alert.alert(
      "Remove meal?",
      meal.description,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/api/meals/${meal.id}`, { method: "DELETE" });
              await loadToday();
            } catch (e: any) {
              Alert.alert("Could not remove meal", e?.message || "");
            }
          },
        },
      ],
    );
  }

  if (booting)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Calorie Tracer</Text>
          <Text style={styles.muted}>Starting your nutrition space…</Text>
        </View>
      </SafeAreaView>
    );
  if (onboarding)
    return (
      <Onboarding
        profile={profile}
        appleAvailable={appleAvailable}
        onApple={signInApple}
        onComplete={saveOnboarding}
      />
    );
  if (!profile)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Welcome</Text>
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
              }
              buttonStyle={
                AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={12}
              style={styles.appleButton}
              onPress={signInApple}
            />
          )}
          <Pressable
            style={styles.secondaryButton}
            onPress={() => setOnboarding(true)}
          >
            <Text style={styles.secondaryText}>
              Continue in development mode
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );

  if (showAdd)
    return (
      <>
        <AddMeal
          mealText={mealText}
          setMealText={setMealText}
          mealType={mealType}
          setMealType={setMealType}
          analysis={analysis}
          analyze={analyze}
          analyzeLoading={mealAnalyzeLoading}
          saveMeal={saveMeal}
          close={() => {
            setShowAdd(false);
            setAnalysis(null);
          }}
        />
        <TabBar tab={tab} setTab={setTab} />
      </>
    );
  if (tab === "ai")
    return (
      <>
        <AI
          chatText={chatText}
          setChatText={setChatText}
          chatMessages={chatMessages}
          chatLoading={chatLoading}
          sendChat={sendChat}
          clearChat={clearChat}
          planResponse={planResponse}
          planCount={planCount}
          planLoading={planLoading}
          createPlan={createPlan}
          clearPlan={clearPlan}
          addPlanToToday={addPlanToToday}
          planAddLoading={planAddLoading}
          resetPlanLimit={resetPlanLimit}
          foodToDecompose={foodToDecompose}
          setFoodToDecompose={setFoodToDecompose}
          decomposeResponse={decomposeResponse}
          suggestedMealDescription={suggestedMealDescription}
          decomposeLoading={decomposeLoading}
          decomposeFood={decomposeFood}
          clearDecompose={clearDecompose}
          mealCandidate={mealCandidate}
          addCandidateToToday={addCandidateToToday}
          dismissMealCandidate={dismissMealCandidate}
        />
        <TabBar tab={tab} setTab={setTab} />
      </>
    );
  if (tab === "profile")
    return (
      <>
        <ProfileScreen
          profile={profile}
          onEdit={() => setOnboarding(true)}
          onSignOut={async () => {
            await SecureStore.deleteItemAsync("session_token");
            setProfile(null);
            setOnboarding(false);
          }}
        />
        <TabBar tab={tab} setTab={setTab} />
      </>
    );

  const s = summary ?? {
    consumed: emptyTotals,
    goals: {
      ...emptyTotals,
      calories: profile.calorie_goal,
      protein_g: profile.protein_goal,
      carbs_g: profile.carb_goal,
      fat_g: profile.fat_goal,
    },
    remaining_calories: profile.calorie_goal,
    remaining_protein_g: profile.protein_goal,
  };
  const progress = s.goals.calories
    ? Math.min(s.consumed.calories / s.goals.calories, 1)
    : 0;
  return (
    <>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.eyebrow}>TODAY</Text>
              <Text style={styles.title}>Hi, {profile.name.split(" ")[0]}</Text>
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profile.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.heroCard}>
            <Text style={styles.heroKcal}>
              {Math.round(s.consumed.calories)}
            </Text>
            <Text style={styles.heroUnit}>
              / {Math.round(s.goals.calories)} kcal
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progress * 100}%` }]}
              />
            </View>
            <Text style={styles.remaining}>
              {Math.round(s.remaining_calories)} kcal remaining
            </Text>
          </View>
          <View style={styles.macroGrid}>
            <Macro
              label="Protein"
              value={s.consumed.protein_g}
              goal={s.goals.protein_g}
            />
            <Macro
              label="Carbs"
              value={s.consumed.carbs_g}
              goal={s.goals.carbs_g}
            />
            <Macro label="Fat" value={s.consumed.fat_g} goal={s.goals.fat_g} />
            <Macro label="Sugar" value={s.consumed.sugar_g} />
          </View>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Meals</Text>
            <Text style={styles.muted}>{meals.length} logged</Text>
          </View>

          {([
            ["breakfast", "Breakfast"],
            ["lunch", "Lunch"],
            ["dinner", "Dinner"],
            ["snack", "Snacks"],
            ["meal", "Other"],
          ] as const).map(([key, label]) => (
            <View key={key} style={styles.mealSection}>
              <View style={styles.mealSectionHeader}>
                <Text style={styles.mealSectionTitle}>{label}</Text>
                <Text style={styles.muted}>{groupedMeals[key].length}</Text>
              </View>

              {groupedMeals[key].length === 0 ? (
                <Text style={styles.mealEmpty}>No meal added</Text>
              ) : (
                groupedMeals[key].map((m) => (
                  <View key={m.id} style={styles.mealCard}>
                    <View style={styles.mealMain}>
                      <Text style={styles.mealDescription}>{m.description}</Text>
                      <Text style={styles.mealMeta}>
                        Protein {Math.round(m.protein_g)}g · Carbs {Math.round(m.carbs_g)}g · Fat {Math.round(m.fat_g)}g
                      </Text>
                    </View>
                    <View style={styles.mealActions}>
                      <Text style={styles.mealKcal}>
                        {Math.round(m.calories)} kcal
                      </Text>
                      <Pressable onPress={() => confirmDeleteMeal(m)} hitSlop={8}>
                        <Text style={styles.deleteText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          ))}
          <Pressable
            style={styles.primaryButton}
            onPress={() => setShowAdd(true)}
          >
            <Text style={styles.primaryText}>＋ Add meal</Text>
          </Pressable>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Daily target</Text>
            <Text style={styles.muted}>
              {profile.goal === "lose"
                ? `Weight loss · ${profile.weight_loss_speed}`
                : profile.goal === "gain"
                  ? "Weight gain"
                  : "Maintenance"}{" "}
              · {Math.round(profile.calorie_goal)} kcal/day
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
      <TabBar tab={tab} setTab={setTab} />
    </>
  );
}

function Onboarding({
  profile,
  appleAvailable,
  onApple,
  onComplete,
}: {
  profile: Profile | null;
  appleAvailable: boolean;
  onApple: () => void;
  onComplete: (d: any) => void;
}) {
  const [step, setStep] = useState(profile?.onboarding_complete ? 6 : 0);
  const [data, setData] = useState<any>({
    name: profile?.name === "Demo User" ? "" : profile?.name || "",
    age: "",
    sex: "male",
    height_cm: "",
    weight_kg: "",
    activity_level: "moderate",
    goal: "lose",
    weight_loss_speed: "moderate",
  });
  const update = (k: string, v: any) => setData((x: any) => ({ ...x, [k]: v }));
  if (step === 0)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>CALORIE TRACER</Text>
          <Text style={styles.title}>Nutrition, without the spreadsheet.</Text>
          <Text style={styles.subtitle}>
            Log meals naturally, see your targets and ask your nutrition AI.
          </Text>
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
              }
              buttonStyle={
                AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={12}
              style={styles.appleButton}
              onPress={onApple}
            />
          )}
          <Pressable style={styles.secondaryButton} onPress={() => setStep(1)}>
            <Text style={styles.secondaryText}>Set up profile</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  const fields: any = {
    1: ["name", "What should we call you?", "text"],
    2: ["age", "How old are you?", "number"],
    3: ["height_cm", "Your height (cm)", "number"],
    4: ["weight_kg", "Your current weight (kg)", "number"],
  };
  if (fields[step]) {
    const [key, label, type] = fields[step];
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.onboarding}>
          <Text style={styles.step}>STEP {step} OF 5</Text>
          <Text style={styles.title}>{label}</Text>
          <TextInput
            autoFocus
            value={String(data[key])}
            onChangeText={(v) =>
              update(key, type === "number" ? v.replace(/[^0-9.]/g, "") : v)
            }
            keyboardType={type === "number" ? "decimal-pad" : "default"}
            placeholder={key === "name" ? "Your name" : ""}
            style={styles.input}
          />
          <Pressable
            style={styles.primaryButton}
            onPress={() => setStep(step + 1)}
          >
            <Text style={styles.primaryText}>Continue</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (step === 5)
    return (
      <ChoiceScreen
        title="How active are you?"
        options={[
          ["sedentary", "Mostly sitting"],
          ["light", "Lightly active"],
          ["moderate", "Moderately active"],
          ["active", "Very active"],
          ["very_active", "Extremely active"],
        ]}
        value={data.activity_level}
        setValue={(v) => update("activity_level", v)}
        next={() => setStep(6)}
      />
    );
  if (step === 6)
    return (
      <ChoiceScreen
        title="What's your goal?"
        options={[
          ["lose", "Lose weight"],
          ["maintain", "Maintain weight"],
          ["gain", "Gain weight"],
        ]}
        value={data.goal}
        setValue={(v) => update("goal", v)}
        next={() => setStep(data.goal === "lose" ? 7 : 8)}
      />
    );
  if (step === 7)
    return (
      <ChoiceScreen
        title="How fast do you want to lose?"
        options={[
          ["slow", "Slow · gentler deficit"],
          ["moderate", "Moderate · balanced"],
          ["fast", "Fast · larger deficit"],
        ]}
        value={data.weight_loss_speed}
        setValue={(v) => update("weight_loss_speed", v)}
        next={() => setStep(8)}
      />
    );
  return (
    <ChoiceScreen
      title="One last thing"
      options={[
        ["male", "Male"],
        ["female", "Female"],
        ["other", "Other / prefer not to say"],
      ]}
      value={data.sex}
      setValue={(v) => update("sex", v)}
      next={() =>
        onComplete({
          ...data,
          age: Number(data.age),
          height_cm: Number(data.height_cm),
          weight_kg: Number(data.weight_kg),
        })
      }
      buttonLabel="Create my target"
    />
  );
}
function ChoiceScreen({
  title,
  options,
  value,
  setValue,
  next,
  buttonLabel = "Continue",
}: {
  title: string;
  options: string[][];
  value: string;
  setValue: (v: string) => void;
  next: () => void;
  buttonLabel?: string;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.onboarding}>
        <Text style={styles.step}>PROFILE</Text>
        <Text style={styles.title}>{title}</Text>
        {options.map(([v, label]) => (
          <Pressable
            key={v}
            style={[styles.choice, value === v && styles.choiceActive]}
            onPress={() => setValue(v)}
          >
            <Text
              style={[
                styles.choiceText,
                value === v && styles.choiceTextActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
        <Pressable style={styles.primaryButton} onPress={next}>
          <Text style={styles.primaryText}>{buttonLabel}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function AddMeal({
  mealText,
  setMealText,
  mealType,
  setMealType,
  analysis,
  analyze,
  analyzeLoading,
  saveMeal,
  close,
}: {
  mealText: string;
  setMealText: (s: string) => void;
  mealType: string;
  setMealType: (s: string) => void;
  analysis: any;
  analyze: () => void;
  analyzeLoading: boolean;
  saveMeal: () => void;
  close: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={close}>
          <Text style={styles.back}>‹ Today</Text>
        </Pressable>
        <Text style={styles.eyebrow}>ADD MEAL</Text>
        <Text style={styles.title}>What did you eat?</Text>
        <View style={styles.segmentRow}>
          {["breakfast", "lunch", "dinner", "snack"].map((x) => (
            <Pressable
              key={x}
              style={[styles.segment, mealType === x && styles.segmentActive]}
              onPress={() => setMealType(x)}
            >
              <Text
                style={
                  mealType === x ? styles.segmentTextActive : styles.segmentText
                }
              >
                {x}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={mealText}
          onChangeText={setMealText}
          placeholder="2 eggs, 150g chicken breast and rice…"
          placeholderTextColor="#8a8f98"
          multiline
          style={styles.textArea}
        />
        <Text style={styles.aiHint}>AI recognizes the food and quantity, then calculates the nutrition.</Text>
        <Pressable
          style={[styles.primaryButton, analyzeLoading && styles.disabledButton]}
          onPress={analyze}
          disabled={analyzeLoading}
        >
          <Text style={styles.primaryText}>
            {analyzeLoading ? "Analyzing with AI…" : "Analyze with AI"}
          </Text>
        </Pressable>
        {analysis && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Meal interpretation</Text>
            {analysis.items.map((item: any, i: number) => (
              <Text key={i} style={styles.rowText}>
                • {item.quantity}
                {item.unit === "g" ? "g" : " ×"} {item.name}
              </Text>
            ))}
            {analysis.unresolved_items?.length > 0 && (
              <Text style={styles.warning}>
                Not resolved: {analysis.unresolved_items.join(", ")}
              </Text>
            )}
            <Text style={styles.profileBig}>
              {Math.round(analysis.totals.calories)} kcal
            </Text>
            <View style={styles.macroGrid}>
              <Macro label="Protein" value={analysis.totals.protein_g} />
              <Macro label="Carbs" value={analysis.totals.carbs_g} />
              <Macro label="Fat" value={analysis.totals.fat_g} />
              <Macro label="Sugar" value={analysis.totals.sugar_g} />
            </View>
            <Pressable style={styles.primaryButton} onPress={saveMeal}>
              <Text style={styles.primaryText}>Add to today</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AI({
  chatText,
  setChatText,
  chatMessages,
  chatLoading,
  sendChat,
  clearChat,
  planResponse,
  planCount,
  planLoading,
  createPlan,
  clearPlan,
  addPlanToToday,
  resetPlanLimit,
  foodToDecompose,
  setFoodToDecompose,
  decomposeResponse,
  suggestedMealDescription,
  decomposeLoading,
  decomposeFood,
  clearDecompose,
  mealCandidate,
  addCandidateToToday,
  dismissMealCandidate,
}: {
  chatText: string;
  setChatText: (s: string) => void;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  sendChat: () => void;
  clearChat: () => void;
  planResponse: AIPlan | null;
  planCount: number;
  planLoading: boolean;
  createPlan: () => void;
  clearPlan: () => void;
  addPlanToToday: () => void;
  planAddLoading: boolean;
  resetPlanLimit: () => void;
  foodToDecompose: string;
  setFoodToDecompose: (s: string) => void;
  decomposeResponse: string;
  suggestedMealDescription: string;
  decomposeLoading: boolean;
  decomposeFood: () => void;
  clearDecompose: () => void;
  mealCandidate: MealCandidate | null;
  addCandidateToToday: () => void;
  dismissMealCandidate: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>ASK AI</Text>
        <Text style={styles.title}>Nutrition AI</Text>
        <Text style={styles.subtitle}>
          Your AI sees today's remaining calories and helps turn dishes into
          trackable meals.
        </Text>

        {/* 1. MEAL PLANNER */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Plan the rest of today</Text>
            <Pressable onPress={clearPlan} hitSlop={8}>
              <Text style={styles.clearText}>New</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>
            AI reads what you have already eaten and your daily target.
          </Text>
          <Text style={styles.limitText}>
            {Math.max(0, 3 - planCount)} of 3 plans remaining today
          </Text>

          <Pressable
            style={[styles.primaryButton, planCount >= 3 && styles.disabledButton]}
            onPress={createPlan}
            disabled={planLoading || planCount >= 3}
          >
            <Text style={styles.primaryText}>
              {planLoading
                ? "Creating…"
                : planResponse
                  ? "Create new / Retry"
                  : "Create my meal plan"}
            </Text>
          </Pressable>
          <Pressable
              style={styles.linkButton}
              onPress={resetPlanLimit}
            >
              <Text style={styles.muted}>
                Developer: Reset daily AI limit
              </Text>
          </Pressable>

          {planResponse ? (
            <View style={styles.aiResult}>
              <Text style={styles.planSummary}>{planResponse.message}</Text>

              <View style={styles.planList}>
                {planResponse.meals.map((meal) => (
                  <View key={`${meal.meal_type}-${meal.name}`} style={styles.planMealCard}>
                    <View style={styles.planMealHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.planMealType}>
                          {meal.meal_type === "snack" ? "SNACKS" : meal.meal_type.toUpperCase()}
                        </Text>
                        <Text style={styles.planMealName}>{meal.name}</Text>
                      </View>
                      <Text style={styles.planMealCalories}>
                        {Math.round(meal.approx_calories)} kcal
                      </Text>
                    </View>
                    <Text style={styles.planMealDescription}>{meal.description}</Text>
                    <Text style={styles.planMealProtein}>
                      ~{Math.round(meal.approx_protein_g)}g protein
                      {meal.approx_carbs_g != null
                        ? ` · ${Math.round(meal.approx_carbs_g)}g carbs`
                        : ""}
                      {meal.approx_fat_g != null
                        ? ` · ${Math.round(meal.approx_fat_g)}g fat`
                        : ""}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={styles.questionText}>
                Add this whole plan to Today?
              </Text>

              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.primaryButtonCompact, planLoading && styles.disabledButton]}
                  onPress={addPlanToToday}
                  disabled={planLoading}
                >
                  <Text style={styles.primaryText}>
                    {planLoading ? "Adding…" : "＋ Add to Today"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButtonCompact}
                  onPress={createPlan}
                  disabled={planCount >= 3 || planLoading || planLoading}
                >
                  <Text style={styles.secondaryText}>Create new / Retry</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* 2. DECOMPOSE FOOD */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>I ate something — what is inside?</Text>
            <Pressable onPress={clearDecompose} hitSlop={8}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>Example: “chicken burrito”</Text>
          <TextInput
            value={foodToDecompose}
            onChangeText={setFoodToDecompose}
            placeholder="What did you eat?"
            placeholderTextColor="#8a8f98"
            style={styles.input}
          />
          <Pressable
            style={styles.secondaryButton}
            onPress={decomposeFood}
            disabled={decomposeLoading}
          >
            <Text style={styles.secondaryText}>
              {decomposeLoading ? "Breaking it down…" : "Break it down"}
            </Text>
          </Pressable>

          {decomposeResponse ? (
            <View style={styles.aiResult}>
              <Text style={styles.chatText}>{decomposeResponse}</Text>
              {suggestedMealDescription ? (
                <>
                  <Text style={styles.muted}>Suggested meal description:</Text>
                  <Text style={styles.copyText}>{suggestedMealDescription}</Text>
                </>
              ) : null}

              {mealCandidate?.source === "decompose" ? (
                <MealCandidateCard
                  candidate={mealCandidate}
                  addCandidateToToday={addCandidateToToday}
                  dismissMealCandidate={dismissMealCandidate}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {/* 3. NORMAL CHAT */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Ask anything</Text>
            <Pressable onPress={clearChat} hitSlop={8}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>

          <View style={styles.chatArea}>
            {chatMessages.length === 0 ? (
              <Text style={styles.muted}>“What should I eat for dinner?”</Text>
            ) : (
              chatMessages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.chatBubble,
                    message.role === "user"
                      ? styles.chatUser
                      : styles.chatAssistant,
                  ]}
                >
                  <Text style={styles.chatBubbleText}>{message.content}</Text>
                </View>
              ))
            )}

            {chatLoading ? (
              <View style={[styles.chatBubble, styles.chatAssistant]}>
                <Text style={styles.muted}>Thinking…</Text>
              </View>
            ) : null}
          </View>

          {mealCandidate?.source === "chat" ? (
            <MealCandidateCard
              candidate={mealCandidate}
              addCandidateToToday={addCandidateToToday}
              dismissMealCandidate={dismissMealCandidate}
            />
          ) : null}

          <TextInput
            value={chatText}
            onChangeText={setChatText}
            placeholder="Ask about today's nutrition…"
            placeholderTextColor="#8a8f98"
            multiline
            style={styles.textArea}
          />
          <Pressable
            style={[styles.primaryButton, chatLoading && styles.disabledButton]}
            onPress={sendChat}
            disabled={chatLoading}
          >
            <Text style={styles.primaryText}>Send</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MealCandidateCard({
  candidate,
  addCandidateToToday,
  dismissMealCandidate,
}: {
  candidate: MealCandidate;
  addCandidateToToday: () => void;
  dismissMealCandidate: () => void;
}) {
  return (
    <View style={styles.candidateCard}>
      <Text style={styles.candidateTitle}>Add this to your Today meal?</Text>
      <Text style={styles.copyText}>{candidate.description}</Text>
      <Text style={styles.candidateKcal}>
        {Math.round(candidate.totals.calories)} kcal
      </Text>
      <Text style={styles.muted}>
        Protein {Math.round(candidate.totals.protein_g)}g · Carbs {Math.round(candidate.totals.carbs_g)}g · Fat {Math.round(candidate.totals.fat_g)}g
      </Text>
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButtonCompact} onPress={addCandidateToToday}>
          <Text style={styles.primaryText}>Add to Today</Text>
        </Pressable>
        <Pressable style={styles.secondaryButtonCompact} onPress={dismissMealCandidate}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProfileScreen({
  profile,
  onEdit,
  onSignOut,
}: {
  profile: Profile;
  onEdit: () => void;
  onSignOut: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>PROFILE</Text>
        <Text style={styles.title}>{profile.name}</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Daily target</Text>
          <Text style={styles.profileBig}>
            {Math.round(profile.calorie_goal)} kcal
          </Text>
          <Text style={styles.muted}>
            {profile.goal === "lose"
              ? `Lose weight · ${profile.weight_loss_speed}`
              : profile.goal === "gain"
                ? "Gain weight"
                : "Maintain weight"}
          </Text>
        </View>
        <View style={styles.profileRows}>
          <Row label="Weight" value={`${profile.weight_kg ?? "—"} kg`} />
          <Row label="Height" value={`${profile.height_cm ?? "—"} cm`} />
          <Row label="Age" value={`${profile.age ?? "—"}`} />
          <Row
            label="Activity"
            value={profile.activity_level.replace("_", " ")}
          />
          <Row
            label="Protein target"
            value={`${Math.round(profile.protein_goal)} g`}
          />
        </View>
        <Pressable style={styles.secondaryButton} onPress={onEdit}>
          <Text style={styles.secondaryText}>Edit profile</Text>
        </Pressable>
        <Pressable style={styles.linkButton} onPress={onSignOut}>
          <Text style={styles.dangerText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}
function TabBar({ tab, setTab }: { tab: string; setTab: (x: any) => void }) {
  return (
    <View style={styles.tabBar}>
      <Tab
        label="Today"
        icon="⌂"
        active={tab === "today"}
        onPress={() => setTab("today")}
      />
      <Tab
        label="Ask AI"
        icon="✦"
        active={tab === "ai"}
        onPress={() => setTab("ai")}
      />
      <Tab
        label="Profile"
        icon="◯"
        active={tab === "profile"}
        onPress={() => setTab("profile")}
      />
    </View>
  );
}
function Tab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabIcon, active && styles.tabActiveText]}>
        {icon}
      </Text>
      <Text style={[styles.tabLabel, active && styles.tabActiveText]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Macro({
  label,
  value,
  goal,
}: {
  label: string;
  value: number;
  goal?: number;
}) {
  const p = goal ? Math.min(value / goal, 1) : 0;
  return (
    <View style={styles.macroCard}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>{Math.round(value)}g</Text>
      {goal ? (
        <>
          <View style={styles.miniTrack}>
            <View style={[styles.miniFill, { width: `${p * 100}%` }]} />
          </View>
          <Text style={styles.macroGoal}>/ {Math.round(goal)}g</Text>
        </>
      ) : (
        <Text style={styles.macroGoal}>today</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f6f2" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  container: { padding: 20, paddingBottom: 110, gap: 14 },
  onboarding: { padding: 24, paddingTop: 60, paddingBottom: 50, gap: 16 },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.6,
    color: "#74806f",
    fontWeight: "800",
  },
  step: {
    fontSize: 12,
    letterSpacing: 1.4,
    color: "#75816f",
    fontWeight: "800",
  },
  title: { fontSize: 30, fontWeight: "800", color: "#20261f", marginTop: 4 },
  subtitle: {
    fontSize: 16,
    lineHeight: 23,
    color: "#747a72",
    textAlign: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#dce8d5",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "800", color: "#40543a" },
  heroCard: {
    backgroundColor: "#283127",
    borderRadius: 26,
    padding: 22,
    gap: 10,
  },
  heroKcal: { fontSize: 54, fontWeight: "800", color: "#f5f7ef" },
  heroUnit: { color: "#c9d0c5", fontSize: 15 },
  remaining: { color: "#dbe3d6", fontSize: 14 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "#454e43",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#b7d48e", borderRadius: 5 },
  macroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  macroCard: {
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 150,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 15,
    gap: 5,
  },
  macroLabel: { fontSize: 13, fontWeight: "700", color: "#7a8277" },
  macroValue: { fontSize: 25, fontWeight: "800", color: "#20261f" },
  macroGoal: { fontSize: 12, color: "#8b9189" },
  miniTrack: {
    height: 5,
    backgroundColor: "#e8ece5",
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 2,
  },
  miniFill: { height: "100%", backgroundColor: "#91aa76" },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  sectionTitle: { fontSize: 20, fontWeight: "800", color: "#20261f" },
  card: { backgroundColor: "white", borderRadius: 20, padding: 18, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: "#20261f" },
  mealCard: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
  },
  mealType: {
    fontSize: 11,
    color: "#8b9189",
    fontWeight: "800",
    letterSpacing: 1,
  },
  mealDescription: { marginTop: 4, fontSize: 15, color: "#2c342b" },
  mealKcal: { fontSize: 15, fontWeight: "800", color: "#3f5f34" },
  primaryButton: {
    backgroundColor: "#526b45",
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 2,
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#cbd4c6",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  secondaryText: { color: "#465840", fontSize: 15, fontWeight: "800" },
  linkButton: { alignItems: "center", padding: 14 },
  dangerText: { color: "#a14c45", fontSize: 15, fontWeight: "700" },
  textArea: {
    minHeight: 130,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 16,
    fontSize: 16,
    lineHeight: 23,
    color: "#20261f",
    textAlignVertical: "top",
  },
  appleButton: { width: "100%", height: 50 },
  choice: {
    backgroundColor: "white",
    borderRadius: 17,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e3e6df",
  },
  choiceActive: { borderColor: "#526b45", backgroundColor: "#e7efe2" },
  choiceText: { fontSize: 16, fontWeight: "700", color: "#465046" },
  choiceTextActive: { color: "#3e5736" },
  input: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 18,
    fontSize: 20,
    color: "#20261f",
    borderWidth: 1,
    borderColor: "#e3e6df",
  },
  muted: { color: "#7a8277", fontSize: 14 },
  aiHint: { color: "#697469", fontSize: 13, lineHeight: 18 },
  chatText: { color: "#3b4339", lineHeight: 22, fontSize: 15 },
  aiResult: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#edf0eb",
    gap: 8,
  },
  copyText: {
    backgroundColor: "#f3f5f0",
    borderRadius: 12,
    padding: 12,
    color: "#354034",
    fontSize: 14,
    lineHeight: 21,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  clearText: {
    color: "#526b45",
    fontSize: 13,
    fontWeight: "800",
  },
  limitText: {
    color: "#8a927f",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  disabledButton: {
    opacity: 0.5,
  },
  questionText: {
    color: "#2f382d",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButtonCompact: {
    flex: 1,
    backgroundColor: "#526b45",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonCompact: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd4c6",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  chatArea: {
    gap: 10,
    marginTop: 2,
  },
  chatBubble: {
    maxWidth: "88%",
    padding: 14,
    borderRadius: 18,
  },
  chatUser: {
    alignSelf: "flex-end",
    backgroundColor: "#dce9d5",
    borderBottomRightRadius: 5,
  },
  chatAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#f1f3ef",
    borderBottomLeftRadius: 5,
  },
  chatBubbleText: {
    color: "#30382f",
    fontSize: 15,
    lineHeight: 21,
  },
  candidateCard: {
    marginTop: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#eef4ea",
    gap: 8,
  },
  candidateTitle: {
    color: "#30402e",
    fontSize: 15,
    fontWeight: "800",
  },
  candidateKcal: {
    color: "#3f5f34",
    fontSize: 25,
    fontWeight: "800",
  },
  mealSection: {
    gap: 8,
    marginTop: 4,
  },
  mealSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  mealSectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#56604f",
  },
  mealEmpty: {
    color: "#9aa196",
    fontSize: 13,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  mealMain: {
    flex: 1,
    gap: 5,
    paddingRight: 8,
  },
  mealMeta: {
    color: "#8b9189",
    fontSize: 12,
    lineHeight: 18,
  },
  mealActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  deleteText: {
    color: "#a14c45",
    fontSize: 12,
    fontWeight: "800",
  },
  planSummary: {
    color: "#4c5648",
    fontSize: 14,
    lineHeight: 21,
  },
  planList: {
    gap: 10,
    marginTop: 4,
  },
  planMealCard: {
    backgroundColor: "#f5f7f3",
    borderRadius: 16,
    padding: 14,
    gap: 7,
  },
  planMealHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  planMealType: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#899082",
  },
  planMealName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#283127",
    marginTop: 2,
  },
  planMealCalories: {
    fontSize: 14,
    fontWeight: "800",
    color: "#3f5f34",
  },
  planMealDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "#56604f",
  },
  planMealProtein: {
    fontSize: 12,
    fontWeight: "700",
    color: "#75816f",
  },
  profileBig: { fontSize: 36, fontWeight: "800", color: "#20261f" },
  profileRows: {
    backgroundColor: "white",
    borderRadius: 20,
    overflow: "hidden",
  },
  profileRow: {
    padding: 17,
    borderBottomWidth: 1,
    borderBottomColor: "#edf0eb",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#2f382d",
    textTransform: "capitalize",
  },
  tabBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    height: 72,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "#e0e5dc",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  tabActive: {
    backgroundColor: "#e8efe3",
    marginHorizontal: 8,
    borderRadius: 20,
    paddingVertical: 7,
  },
  tabIcon: { fontSize: 19, color: "#8a9286" },
  tabLabel: { fontSize: 11, fontWeight: "700", color: "#8a9286" },
  tabActiveText: { color: "#40583a" },
  rowText: { color: "#3e463b", fontSize: 15 },
  segmentRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  segment: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: "#e7ebe4",
    borderRadius: 20,
  },
  segmentActive: { backgroundColor: "#d1e1c7" },
  segmentText: { color: "#727a70", fontSize: 13, fontWeight: "700" },
  segmentTextActive: { color: "#3e5736", fontSize: 13, fontWeight: "800" },
  back: { fontSize: 17, color: "#52664c", fontWeight: "700" },
  warning: { color: "#9a6b27", fontSize: 13 },
});
