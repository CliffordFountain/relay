use dashmap::DashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Request coalescer for de-duplicating in-flight read operations.
///
/// When many concurrent requests ask for the same data (keyed by K),
/// only one actual query executes. All other callers subscribe to the
/// result of the first query via a broadcast channel.
#[allow(dead_code)]
pub struct Coalescer<K: Eq + Hash + Clone, V: Clone> {
    in_flight: Arc<DashMap<K, broadcast::Sender<Result<V, String>>>>,
}

impl<K, V> Coalescer<K, V>
where
    K: Eq + Hash + Clone + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    /// Create a new coalescer instance.
    pub fn new() -> Self {
        Self {
            in_flight: Arc::new(DashMap::new()),
        }
    }

    /// If a request for this key is already in-flight, subscribe to its result.
    /// Otherwise, execute the query and broadcast the result to any waiters.
    #[allow(dead_code)]
    pub async fn get_or_query<F, Fut, E>(
        &self,
        key: K,
        query: F,
    ) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
        E: std::fmt::Display + From<String>,
    {
        // Check if there is already an in-flight request for this key
        if let Some(sender) = self.in_flight.get(&key) {
            let mut rx = sender.subscribe();
            drop(sender); // Release DashMap ref before awaiting
            return match rx.recv().await {
                Ok(Ok(val)) => Ok(val),
                Ok(Err(e)) => Err(E::from(e)),
                Err(_) => Err(E::from("coalesced request channel closed".to_string())),
            };
        }

        // No in-flight request -- create one
        let (tx, _) = broadcast::channel(1);
        self.in_flight.insert(key.clone(), tx.clone());

        // Execute the actual query
        let result = query().await;

        // Broadcast result to all waiters
        match &result {
            Ok(value) => {
                let _ = tx.send(Ok(value.clone()));
            }
            Err(e) => {
                let _ = tx.send(Err(e.to_string()));
            }
        }

        // Remove from in-flight map
        self.in_flight.remove(&key);

        result
    }
}

impl<K, V> Default for Coalescer<K, V>
where
    K: Eq + Hash + Clone + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}
