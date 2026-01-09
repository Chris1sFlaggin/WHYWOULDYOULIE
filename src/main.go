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

const (
	ActionRegisterUser = "REGISTER_USER"
	ActionPostImage    = "POST_IMAGE"
	ActionVote         = "VOTE"
	ActionFollow       = "FOLLOW"
	ActionUnfollow     = "UNFOLLOW"
	ActionSavePost     = "SAVE_POST"
	ActionRepost       = "REPOST"
	ActionUnrepost     = "UNREPOST"
	ActionSetProfile   = "SET_PROFILE" // NUOVO
)

type UserProfile struct {
	Username     string
	PublicKeyPEM []byte
	RegisteredAt int64
	Bio          string // NUOVO: Descrizione utente
	Following    []string
	Followers    []string
	SavedPosts   []string
	Reposted     []string
}

type TxData struct {
	ActionType       string
	Sender           string
	PublicKeyPayload []byte
	ImagePayload     []byte
	TargetHash       string
	TargetUser       string
	VoteType         string
	ContentText      string // Usato per nome immagine o per la BIO
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
	Comments     []string
	Reposts      int
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
			return nil, fmt.Errorf("❌ RIFIUTATO: Parametri non conformi (E:%.2f D:%.2f)", metrics.Entropy, metrics.StdDev)
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
		fmt.Println("💾 Loading DB da data/...")
		bc, err := LoadFromFile()
		if err == nil {
			return bc
		}
	}
	genesisTx := TxData{ActionType: "GENESIS", Sender: "SYSTEM"}
	genesisBlock := &Block{Timestamp: time.Now().Unix(), Transaction: genesisTx}
	genesisBlock.SetHash()
	return &Blockchain{
		Blocks:      []*Block{genesisBlock},
		ImagesState: make(map[string]*ImageReputation),
		UsersState:  make(map[string]*UserProfile),
	}
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
			Username:     tx.Sender,
			PublicKeyPEM: tx.PublicKeyPayload,
			RegisteredAt: block.Timestamp,
			Following:    []string{}, Followers: []string{}, SavedPosts: []string{}, Reposted: []string{},
			Bio: "New user of WhyWouldYouLie.", // Bio default
		}

	case ActionSetProfile: // NUOVO
		if u, ok := bc.UsersState[tx.Sender]; ok {
			u.Bio = tx.ContentText
		}

	case ActionPostImage:
		bc.ImagesState[blockHashStr] = &ImageReputation{
			Verdict: "VOTING_OPEN", CreationTime: block.Timestamp,
			Comments: []string{}, Reposts: 0,
		}

	case ActionVote:
		if entry, ok := bc.ImagesState[tx.TargetHash]; ok {
			if tx.VoteType == "BELIEVE" {
				entry.Likes++
			}
			if tx.VoteType == "FAKE" {
				entry.Fakes++
			}
			entry.Verdict = "CONTESTED"
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
		sender := bc.UsersState[tx.Sender]
		if sender != nil {
			if !contains(sender.SavedPosts, tx.TargetHash) {
				sender.SavedPosts = append(sender.SavedPosts, tx.TargetHash)
			}
		}

	case ActionRepost:
		sender := bc.UsersState[tx.Sender]
		if sender != nil && !contains(sender.Reposted, tx.TargetHash) {
			sender.Reposted = append(sender.Reposted, tx.TargetHash)
		}
		if entry, ok := bc.ImagesState[tx.TargetHash]; ok {
			entry.Reposts++
		}

	case ActionUnrepost:
		sender := bc.UsersState[tx.Sender]
		if sender != nil {
			sender.Reposted = remove(sender.Reposted, tx.TargetHash)
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
	newSlice := []string{}
	for _, item := range slice {
		if item != val {
			newSlice = append(newSlice, item)
		}
	}
	return newSlice
}

func (bc *Blockchain) AddBlock(tx TxData) (string, error) {
	if tx.ActionType == ActionRegisterUser {
		if _, exists := bc.UsersState[tx.Sender]; exists {
			return "", fmt.Errorf("⛔ ERRORE: L'utente '%s' esiste già!", tx.Sender)
		}
	} else {
		if _, exists := bc.UsersState[tx.Sender]; !exists {
			return "", fmt.Errorf("⛔ ACCESSO NEGATO: Utente non registrato.")
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

	hashStr := hex.EncodeToString(newBlock.Hash)
	fmt.Printf("⛓️  BLOCK: %s | Act: %s | Hash: %s...\n", tx.Sender, tx.ActionType, hashStr[0:6])
	return hashStr, nil
}

func main() {
	Chain = NewBlockchain()
	fmt.Printf("--- BLOCKCHAIN SOCIAL CORE ---\n")
	StartServer()
}
