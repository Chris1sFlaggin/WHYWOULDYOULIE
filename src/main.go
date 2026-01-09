package main

/*
// --- CONFIGURAZIONE CGO ---
#cgo LDFLAGS: -lm
#cgo CFLAGS: -I${SRCDIR}/core
#include <math.h>
#include <stdlib.h>

typedef struct {
    double entropy;
    double std_dev;
} AnalysisResult;

#include "analyzer.c"
*/
import "C"

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"strconv"
	"time"
	"unsafe"
)

const DbFileName = "data/blockchain.json"
const MinEntropy = 7.0
const MinStdDev = 40.0
const MaxStdDev = 90.0

// --- ECONOMY SETTINGS ---
const InitialCredits = 20
const CostPost = 5
const CostVote = 5
const PostDuration = 24 * time.Hour // Durata scommessa

const (
	ActionRegisterUser = "REGISTER_USER"
	ActionPostImage    = "POST_IMAGE"
	ActionVote         = "VOTE"
	ActionFollow       = "FOLLOW"
	ActionUnfollow     = "UNFOLLOW"
	ActionSavePost     = "SAVE_POST"
	ActionRepost       = "REPOST"
	ActionUnrepost     = "UNREPOST"
	ActionSetProfile   = "SET_PROFILE"
	ActionComment      = "COMMENT"
	ActionPrivateMsg   = "PRIVATE_MSG"
	ActionResolve      = "RESOLVE_POST" // NUOVO: Assegna i premi
)

type PrivateMessage struct {
	From      string
	Content   string
	Timestamp int64
}

type Comment struct {
	User      string
	Content   string
	Timestamp int64
}

type UserProfile struct {
	Username     string
	PublicKeyPEM []byte
	RegisteredAt int64
	Bio          string
	Avatar       string
	Following    []string
	Followers    []string
	SavedPosts   []string
	Reposted     []string
	Inbox        []PrivateMessage
	Balance      int // NUOVO: Portafoglio Utente
}

type TxData struct {
	ActionType       string
	Sender           string
	PublicKeyPayload []byte
	ImagePayload     []byte
	TargetHash       string
	TargetUser       string
	VoteType         string
	ContentText      string
}

type Block struct {
	Timestamp     int64
	PrevBlockHash []byte
	Hash          []byte
	Transaction   TxData
	EntropyScore  float64
	StdDevScore   float64
}

type ImageReputation struct {
	Likes        int
	Fakes        int
	Verdict      string
	CreationTime int64
	Comments     []Comment
	Reposts      int
	Author       string            // Serve per dare i soldi all'autore
	PrizePool    int               // Totale token scommessi
	Voters       map[string]string // Chi ha votato cosa (User -> "BELIEVE"/"FAKE")
	Resolved     bool              // Se è già stato pagato
}

type Blockchain struct {
	Blocks      []*Block
	ImagesState map[string]*ImageReputation
	UsersState  map[string]*UserProfile
}

type AnalysisMetrics struct {
	Entropy float64
	StdDev  float64
}

var Chain *Blockchain

// --- UTILS ---
func Client_GenerateKeys(username string) []byte {
	keyPath := fmt.Sprintf("keys/%s_private.pem", username)
	if _, err := os.Stat(keyPath); err == nil {
		return []byte("KEYS_ALREADY_EXIST_MOCK")
	}
	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	privBytes := x509.MarshalPKCS1PrivateKey(privateKey)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privBytes})
	os.WriteFile(keyPath, privPEM, 0600)
	pubASN1, _ := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	return pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY", Bytes: pubASN1})
}

func RunAnalyzer(data []byte) AnalysisMetrics {
	if len(data) == 0 {
		return AnalysisMetrics{0, 0}
	}
	cData := (*C.uchar)(unsafe.Pointer(&data[0]))
	cLen := C.int(len(data))
	cResult := C.analyze_image_metrics(cData, cLen)
	return AnalysisMetrics{float64(cResult.entropy), float64(cResult.std_dev)}
}

func (b *Block) SetHash() {
	timestamp := []byte(strconv.FormatInt(b.Timestamp, 10))
	metrics := []byte(fmt.Sprintf("%.4f|%.4f", b.EntropyScore, b.StdDevScore))
	txData := []byte(b.Transaction.Sender + b.Transaction.ActionType + b.Transaction.TargetHash)
	headers := bytes.Join([][]byte{b.PrevBlockHash, txData, b.Transaction.ImagePayload, metrics, timestamp}, []byte{})
	hash := sha256.Sum256(headers)
	b.Hash = hash[:]
}

func NewBlock(tx TxData, prevHash []byte) (*Block, error) {
	block := &Block{Timestamp: time.Now().Unix(), PrevBlockHash: prevHash, Transaction: tx}
	if tx.ActionType == ActionPostImage {
		metrics := RunAnalyzer(tx.ImagePayload)
		block.EntropyScore = metrics.Entropy
		block.StdDevScore = metrics.StdDev
		if metrics.Entropy < MinEntropy || metrics.StdDev < MinStdDev || metrics.StdDev > MaxStdDev {
			return nil, fmt.Errorf("❌ RIFIUTATO dall'Analyzer: Foto non compatibile.")
		}
	}
	block.SetHash()
	return block, nil
}

func NewBlockchain() *Blockchain {
	os.MkdirAll("data", 0755)
	os.MkdirAll("keys", 0755)
	os.MkdirAll("uploads", 0755)
	if _, err := os.Stat(DbFileName); err == nil {
		bc, err := LoadFromFile()
		if err == nil {
			return bc
		}
	}
	genesisTx := TxData{ActionType: "GENESIS", Sender: "SYSTEM"}
	genesisBlock := &Block{Timestamp: time.Now().Unix(), Transaction: genesisTx}
	genesisBlock.SetHash()
	return &Blockchain{Blocks: []*Block{genesisBlock}, ImagesState: make(map[string]*ImageReputation), UsersState: make(map[string]*UserProfile)}
}

func (bc *Blockchain) SaveToFile() {
	file, _ := os.Create(DbFileName)
	defer file.Close()
	json.NewEncoder(file).Encode(bc)
}

func LoadFromFile() (*Blockchain, error) {
	file, err := os.Open(DbFileName)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var bc Blockchain
	if err := json.NewDecoder(file).Decode(&bc); err != nil {
		return nil, err
	}
	return &bc, nil
}

// --- LOGICA DI STATO (ECONOMY) ---
func (bc *Blockchain) updateState(block *Block) {
	tx := block.Transaction
	blockHashStr := hex.EncodeToString(block.Hash)

	if bc.UsersState == nil {
		bc.UsersState = make(map[string]*UserProfile)
	}
	if bc.ImagesState == nil {
		bc.ImagesState = make(map[string]*ImageReputation)
	}

	switch tx.ActionType {
	case ActionRegisterUser:
		bc.UsersState[tx.Sender] = &UserProfile{
			Username: tx.Sender, PublicKeyPEM: tx.PublicKeyPayload, RegisteredAt: block.Timestamp,
			Following: []string{}, Followers: []string{}, SavedPosts: []string{}, Reposted: []string{},
			Inbox: []PrivateMessage{},
			Bio:   "New user.", Avatar: "",
			Balance: InitialCredits, // 20 Crediti iniziali
		}

	case ActionPostImage:
		// Scala i soldi al poster
		if u, ok := bc.UsersState[tx.Sender]; ok {
			u.Balance -= CostPost
		}
		bc.ImagesState[blockHashStr] = &ImageReputation{
			Verdict: "VOTING_OPEN", CreationTime: block.Timestamp, Comments: []Comment{}, Reposts: 0,
			Author:    tx.Sender,
			PrizePool: CostPost, // Il poster mette i primi 5
			Voters:    make(map[string]string),
			Resolved:  false,
		}

	case ActionVote:
		// Scala i soldi al votante
		if u, ok := bc.UsersState[tx.Sender]; ok {
			u.Balance -= CostVote
		}
		if entry, ok := bc.ImagesState[tx.TargetHash]; ok {
			if tx.VoteType == "BELIEVE" {
				entry.Likes++
			}
			if tx.VoteType == "FAKE" {
				entry.Fakes++
			}
			entry.PrizePool += CostVote           // Aggiungi alla pool
			entry.Voters[tx.Sender] = tx.VoteType // Registra il voto per dividere i soldi dopo
		}

	case ActionResolve: // LOGICA DI PAGAMENTO
		entry, ok := bc.ImagesState[tx.TargetHash]
		if ok && !entry.Resolved {
			entry.Resolved = true
			totalPool := entry.PrizePool

			// VINCONO I REAL (Likes > Fakes)
			if entry.Likes > entry.Fakes {
				entry.Verdict = "CONFIRMED_REAL"
				// Vincitori: Autore + Chi ha votato BELIEVE
				winnersCount := 1 + entry.Likes
				rewardPerPerson := totalPool / winnersCount

				// Paga Autore
				if auth, exists := bc.UsersState[entry.Author]; exists {
					auth.Balance += rewardPerPerson
				}
				// Paga Votanti
				for voter, vote := range entry.Voters {
					if vote == "BELIEVE" {
						if vUser, exists := bc.UsersState[voter]; exists {
							vUser.Balance += rewardPerPerson
						}
					}
				}

			} else {
				// VINCONO I FAKE (Fakes >= Likes)
				entry.Verdict = "BANNED_FAKE"
				// Vincitori: Solo chi ha votato FAKE (l'autore perde tutto)
				if entry.Fakes > 0 {
					rewardPerPerson := totalPool / entry.Fakes
					for voter, vote := range entry.Voters {
						if vote == "FAKE" {
							if vUser, exists := bc.UsersState[voter]; exists {
								vUser.Balance += rewardPerPerson
							}
						}
					}
				}
				// Nota: Se vince Fake, l'autore non riceve nulla e il post viene "bannato" (verdict changed)
			}
		}

	// ... (Altri casi standard: SetProfile, Comment, Msg, Follow, etc. rimangono uguali ma non toccano il balance)
	case ActionSetProfile:
		if u, ok := bc.UsersState[tx.Sender]; ok {
			var data map[string]string
			if err := json.Unmarshal([]byte(tx.ContentText), &data); err == nil {
				if val, exists := data["bio"]; exists {
					u.Bio = val
				}
				if val, exists := data["avatar"]; exists {
					u.Avatar = val
				}
			} else {
				u.Bio = tx.ContentText
			}
		}
	case ActionComment:
		if entry, ok := bc.ImagesState[tx.TargetHash]; ok {
			entry.Comments = append(entry.Comments, Comment{User: tx.Sender, Content: tx.ContentText, Timestamp: block.Timestamp})
		}
	case ActionPrivateMsg:
		if targetUser, ok := bc.UsersState[tx.TargetUser]; ok {
			targetUser.Inbox = append(targetUser.Inbox, PrivateMessage{From: tx.Sender, Content: tx.ContentText, Timestamp: block.Timestamp})
		}
	case ActionFollow:
		sender := bc.UsersState[tx.Sender]
		target := bc.UsersState[tx.TargetUser]
		if sender != nil && target != nil && tx.Sender != tx.TargetUser {
			if !contains(sender.Following, tx.TargetUser) {
				sender.Following = append(sender.Following, tx.TargetUser)
				target.Followers = append(target.Followers, tx.Sender)
			}
		}
	case ActionUnfollow:
		sender := bc.UsersState[tx.Sender]
		target := bc.UsersState[tx.TargetUser]
		if sender != nil && target != nil {
			sender.Following = remove(sender.Following, tx.TargetUser)
			target.Followers = remove(target.Followers, tx.Sender)
		}
	case ActionSavePost:
		if u, ok := bc.UsersState[tx.Sender]; ok {
			if !contains(u.SavedPosts, tx.TargetHash) {
				u.SavedPosts = append(u.SavedPosts, tx.TargetHash)
			}
		}
	case ActionRepost:
		if u, ok := bc.UsersState[tx.Sender]; ok {
			if !contains(u.Reposted, tx.TargetHash) {
				u.Reposted = append(u.Reposted, tx.TargetHash)
			}
		}
		if entry, ok := bc.ImagesState[tx.TargetHash]; ok {
			entry.Reposts++
		}
	case ActionUnrepost:
		if u, ok := bc.UsersState[tx.Sender]; ok {
			u.Reposted = remove(u.Reposted, tx.TargetHash)
		}
		if entry, ok := bc.ImagesState[tx.TargetHash]; ok && entry.Reposts > 0 {
			entry.Reposts--
		}
	}
}

func contains(slice []string, val string) bool {
	for _, item := range slice {
		if item == val {
			return true
		}
	}
	return false
}
func remove(slice []string, val string) []string {
	res := []string{}
	for _, item := range slice {
		if item != val {
			res = append(res, item)
		}
	}
	return res
}

func (bc *Blockchain) AddBlock(tx TxData) (string, error) {
	// --- CONTROLLI ECONOMICI ---
	if tx.ActionType == ActionRegisterUser {
		if _, exists := bc.UsersState[tx.Sender]; exists {
			return "", fmt.Errorf("Utente già esistente")
		}
	} else if tx.ActionType != ActionResolve { // Resolve è di sistema, non richiede balance
		u, exists := bc.UsersState[tx.Sender]
		if !exists {
			return "", fmt.Errorf("Utente non registrato")
		}

		// Controllo Fondi
		if tx.ActionType == ActionPostImage {
			if u.Balance < CostPost {
				return "", fmt.Errorf("Fondi insufficienti (%d). Servono %d crediti per postare.", u.Balance, CostPost)
			}
		}
		if tx.ActionType == ActionVote {
			if u.Balance < CostVote {
				return "", fmt.Errorf("Fondi insufficienti (%d). Servono %d crediti per votare.", u.Balance, CostVote)
			}
		}
	}

	lastBlock := bc.Blocks[len(bc.Blocks)-1]
	newBlock, err := NewBlock(tx, lastBlock.Hash)
	if err != nil {
		return "", err
	}
	bc.Blocks = append(bc.Blocks, newBlock)
	bc.updateState(newBlock)
	bc.SaveToFile()
	fmt.Printf("⛓️  BLOCK: %s | Act: %s | Credits: %s\n", tx.Sender, tx.ActionType, "UPDATED")
	return hex.EncodeToString(newBlock.Hash), nil
}

// --- SYSTEM LOOP: Controlla scadenze ---
func StartSystemLoop() {
	go func() {
		for {
			time.Sleep(30 * time.Second) // Controlla ogni 30 secondi
			now := time.Now().Unix()

			// Cerca post scaduti non risolti
			for hash, img := range Chain.ImagesState {
				if !img.Resolved && (now-img.CreationTime) > int64(PostDuration.Seconds()) {
					fmt.Printf("⏱️  SCADENZA POST: %s. Risoluzione in corso...\n", hash)

					// Crea transazione di sistema
					tx := TxData{
						ActionType: ActionResolve,
						Sender:     "SYSTEM",
						TargetHash: hash,
					}
					Chain.AddBlock(tx)
				}
			}
		}
	}()
}

func main() {
	Chain = NewBlockchain()
	fmt.Printf("--- BLOCKCHAIN ECONOMY CORE ---\n")
	StartSystemLoop() // Avvia il timer
	StartServer()
}
