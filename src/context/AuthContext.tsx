import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile as firebaseUpdateProfile
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export interface User {
    id: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
    profilePicture?: string;
    createdAt: string;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    signup: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    updateProfile: (updates: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Listen for auth state changes
    // Listen for auth state changes
    useEffect(() => {
        // Fallback for missing env vars (Local Mode)
        if (!import.meta.env.VITE_FIREBASE_API_KEY) {
            console.warn("No Firebase API Key found. Running in LOCAL MODE (Auth disabled).");
            setUser(null);
            setIsLoading(false);
            return;
        }

        try {
            const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
                if (firebaseUser) {
                    try {
                        const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                        if (userDoc.exists()) {
                            setUser(userDoc.data() as User);
                        } else {
                            setUser({
                                id: firebaseUser.uid,
                                name: firebaseUser.displayName || "",
                                email: firebaseUser.email || "",
                                createdAt: firebaseUser.metadata.creationTime || new Date().toISOString(),
                            });
                        }
                    } catch (e) {
                        console.error("Error fetching user details:", e);
                        setUser({
                            id: firebaseUser.uid,
                            name: firebaseUser.displayName || "",
                            email: firebaseUser.email || "",
                            createdAt: new Date().toISOString(),
                        });
                    }
                } else {
                    setUser(null);
                }
                setIsLoading(false);
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase Auth Init Error:", error);
            setIsLoading(false);
        }
    }, []);

    const signup = useCallback(
        async (name: string, email: string, password: string): Promise<{ success: boolean; error?: string }> => {
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const firebaseUser = userCredential.user;

                // Update firebase display name
                await firebaseUpdateProfile(firebaseUser, { displayName: name });

                // Force token sync before trying to write to Firestore to prevent permission race conditions
                await firebaseUser.getIdToken(true);

                // Create user doc in Firestore
                const newUser: User = {
                    id: firebaseUser.uid,
                    name,
                    email: email.toLowerCase(),
                    createdAt: new Date().toISOString(),
                };

                await setDoc(doc(db, "users", firebaseUser.uid), newUser);
                setUser(newUser);

                return { success: true };
            } catch (error: any) {
                console.error("Signup error:", error);
                let message = "Signup failed: " + (error.message || "Please try again.");
                if (error.code === "auth/email-already-in-use") {
                    message = "An account with this email already exists.";
                }
                return { success: false, error: message };
            }
        },
        []
    );

    const login = useCallback(
        async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
            try {
                await signInWithEmailAndPassword(auth, email, password);
                // User state will be updated by onAuthStateChanged
                return { success: true };
            } catch (error: any) {
                console.error("Login error:", error);
                let message = "Login failed. Please try again.";
                if (error.code === "auth/wrong-password" || error.code === "auth/user-not-found" || error.code === "auth/invalid-credential") {
                    message = "Incorrect email or password.";
                }
                return { success: false, error: message };
            }
        },
        []
    );

    const logout = useCallback(async () => {
        try {
            await signOut(auth);
            setUser(null);
        } catch (error) {
            console.error("Logout error:", error);
        }
    }, []);

    const updateProfile = useCallback(async (updates: Partial<User>) => {
        if (!user) return;

        try {
            const userRef = doc(db, "users", user.id);
            await updateDoc(userRef, updates);

            // Update local state
            setUser((prev) => prev ? { ...prev, ...updates } : null);

            // If name is updated, update Firebase profile too
            if (updates.name) {
                await firebaseUpdateProfile(auth.currentUser!, { displayName: updates.name });
            }
        } catch (error) {
            console.error("Update profile error:", error);
            throw error;
        }
    }, [user]);

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                isLoading,
                login,
                signup,
                logout,
                updateProfile,
            }}
        >
            {isLoading ? (
                <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
                    <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                    <p className="font-heading font-black tracking-widest text-sm uppercase animate-pulse">
                        Initializing Secure Session...
                    </p>
                </div>
            ) : children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
