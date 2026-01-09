#include <math.h>
#include <stdlib.h>

// ------------------------------------------------------------------
// NOTA IMPORTANTE PER CGO:
// Non definiamo "typedef struct { ... } AnalysisResult;" qui.
//
// La struct è già definita nel blocco di commenti CGO dentro main.go.
// Il compilatore le "unirà" automaticamente.
// ------------------------------------------------------------------

AnalysisResult analyze_image_metrics(unsigned char *data, int length) {
    // Inizializza il risultato a zero
    AnalysisResult result = {0.0, 0.0};
    
    // Se il file è vuoto, ritorna subito
    if (length == 0) return result;
    
    // Array per contare la frequenza di ogni byte (0-255)
    long counts[256] = {0};
    double sum = 0.0;
    double sq_sum = 0.0;
    
    // 1. Scansione unica dei dati
    for (int i = 0; i < length; i++) {
        unsigned char val = data[i];
        counts[val]++;
        
        sum += val;             // Somma per la media
        sq_sum += val * val;    // Somma dei quadrati per la varianza
    }
    
    double total_len = (double)length;
    
    // 2. Calcolo Entropia di Shannon
    // Formula: -sum(p * log2(p))
    for (int i = 0; i < 256; i++) {
        if (counts[i] > 0) {
            double p = (double)counts[i] / total_len;
            result.entropy -= p * log2(p);
        }
    }
    
    // 3. Calcolo Deviazione Standard
    // Formula: sqrt(Media(X^2) - (Media(X))^2)
    double mean = sum / total_len;
    double variance = (sq_sum / total_len) - (mean * mean);
    
    // Protezione per evitare radici di numeri negativi (errori float minimi)
    if (variance < 0) variance = 0;
    
    result.std_dev = sqrt(variance);
    
    return result;
}