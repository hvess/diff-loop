//! A `ReviewStore` in memory, for testing the tools at the port.

use std::{cell::RefCell, collections::BTreeMap};

use diff_loop_core::{OnReviewChange, ReviewKey, ReviewStore, SavedReview, StoreError, WatchGuard};

/// Reviews kept in a map; each one "kept at" `<project>/<branch>.json`.
#[derive(Debug, Default)]
pub(crate) struct Memory(RefCell<BTreeMap<ReviewKey, SavedReview>>);

impl ReviewStore for Memory {
    fn saved(&self, key: &ReviewKey) -> Result<SavedReview, StoreError> {
        Ok(self.0.borrow().get(key).cloned().unwrap_or_default())
    }

    fn save(&self, key: &ReviewKey, review: &SavedReview) -> Result<(), StoreError> {
        self.0.borrow_mut().insert(key.clone(), review.clone());
        Ok(())
    }

    fn change(
        &self,
        key: &ReviewKey,
        change: &mut dyn FnMut(&mut SavedReview),
    ) -> Result<SavedReview, StoreError> {
        let mut review = self.saved(key)?;
        change(&mut review);
        self.save(key, &review)?;
        Ok(review)
    }

    fn location(&self, key: &ReviewKey) -> Option<String> {
        Some(format!("{}/{}.json", key.project, key.branch))
    }

    fn watch(&self, _: &ReviewKey, _: OnReviewChange) -> Result<WatchGuard, StoreError> {
        Ok(Box::new(()))
    }

    fn kept(&self) -> Result<Vec<(ReviewKey, SavedReview)>, StoreError> {
        Ok(self.0.borrow().clone().into_iter().collect())
    }
}
