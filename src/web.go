package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

const HttpPort = ":8080"
const UploadDir = "uploads"
const StaticDir = "static"

type TransactionRequest struct {
	Sender     string `json:"sender"`
	Action     string `json:"action"`
	Content    string `json:"content"`
	TargetHash string `json:"target_hash"`
	VoteType   string `json:"vote_type"`
	TargetUser string `json:"target_user"`
}

func handleGetChain(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Chain)
}

// NUOVO ENDPOINT: Caricamento File Reale
func handleUploadFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == "OPTIONS" {
		return
	}

	// Limite 10 MB
	r.ParseMultipartForm(10 << 20)

	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Errore recupero file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Crea file di destinazione in uploads/
	dstPath := filepath.Join(UploadDir, handler.Filename)
	dst, err := os.Create(dstPath)
	if err != nil {
		http.Error(w, "Errore salvataggio file sul server", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// Copia contenuto
	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "Errore scrittura file", http.StatusInternalServerError)
		return
	}

	// Rispondi con il nome file salvato
	fmt.Printf("📥 WEB UPLOAD: %s salvato in %s\n", handler.Filename, UploadDir)
	json.NewEncoder(w).Encode(map[string]string{"filename": handler.Filename})
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == "OPTIONS" {
		return
	}

	var req TransactionRequest
	body, _ := io.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	pubKey := Client_GenerateKeys(req.Sender)

	tx := TxData{
		ActionType:       ActionRegisterUser,
		Sender:           req.Sender,
		PublicKeyPayload: pubKey,
	}

	hash, err := Chain.AddBlock(tx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	fmt.Fprintf(w, "✅ Utente %s registrato! Block Hash: %s", req.Sender, hash)
}

func handleTransaction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == "OPTIONS" {
		return
	}

	var req TransactionRequest
	body, _ := io.ReadAll(r.Body)
	json.Unmarshal(body, &req)

	tx := TxData{
		ActionType:  req.Action,
		Sender:      req.Sender,
		TargetHash:  req.TargetHash,
		VoteType:    req.VoteType,
		ContentText: req.Content,
		TargetUser:  req.TargetUser,
	}

	if req.Action == ActionPostImage {
		filename := filepath.Base(req.Content)
		fullPath := filepath.Join(UploadDir, filename)
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			http.Error(w, "Errore: File non trovato (fai prima l'upload!)", http.StatusNotFound)
			return
		}
		imgData, err := os.ReadFile(fullPath)
		if err != nil {
			http.Error(w, "Errore lettura file", http.StatusBadRequest)
			return
		}
		tx.ImagePayload = imgData
	}

	hash, err := Chain.AddBlock(tx)
	if err != nil {
		http.Error(w, "Transazione Rifiutata: "+err.Error(), http.StatusNotAcceptable)
		return
	}
	fmt.Fprintf(w, "✅ Successo! Azione: %s, Hash: %s", req.Action, hash)
}

func StartServer() {
	http.HandleFunc("/chain", handleGetChain)
	http.HandleFunc("/register", handleRegister)
	http.HandleFunc("/transact", handleTransaction)
	http.HandleFunc("/upload", handleUploadFile) // Endpoint dedicato

	fsUploads := http.FileServer(http.Dir("./" + UploadDir))
	http.Handle("/files/", http.StripPrefix("/files/", fsUploads))

	fsStatic := http.FileServer(http.Dir("./" + StaticDir))
	http.Handle("/", fsStatic)

	fmt.Printf("🌍 SERVER API ONLINE: http://localhost%s\n", HttpPort)
	log.Fatal(http.ListenAndServe(HttpPort, nil))
}
