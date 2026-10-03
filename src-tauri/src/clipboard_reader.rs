pub const MAX_TEXT_UNITS: usize = 300_000;
pub trait ClipboardApi {
    type Handle: Copy;
    fn open(&mut self) -> bool;
    fn close(&mut self);
    fn data(&mut self) -> Option<Self::Handle>;
    fn size(&mut self, handle: Self::Handle) -> usize;
    fn lock(&mut self, handle: Self::Handle) -> Option<*const u16>;
    fn unlock(&mut self, handle: Self::Handle);
}

/// Only the native adapter supplies allocated memory; validate its byte extent
/// before creating any slice, and release each acquired resource on every result.
pub fn read_text(api: &mut impl ClipboardApi) -> Option<String> {
    if !api.open() { return None; }
    let result = (|| {
        let handle = api.data()?;
        let bytes = api.size(handle);
        if bytes == 0 || bytes % 2 != 0 || bytes > (MAX_TEXT_UNITS + 1) * 2 { return None; }
        let pointer = api.lock(handle)?;
        let result = if pointer.is_null() { None } else {
            let units = unsafe { std::slice::from_raw_parts(pointer, bytes / 2) };
            units.iter().position(|unit| *unit == 0)
                .and_then(|end| String::from_utf16(&units[..end]).ok())
        };
        api.unlock(handle);
        result
    })();
    api.close();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake { memory: Vec<u16>, bytes: usize, open: bool, data: bool, lock: bool, calls: Vec<&'static str> }
    impl Fake { fn new(memory: Vec<u16>) -> Self { let bytes=memory.len()*2;Self {memory,bytes,open:true,data:true,lock:true,calls:vec![]} } }
    impl ClipboardApi for Fake {
        type Handle=usize;
        fn open(&mut self)->bool {self.calls.push("open");self.open}
        fn close(&mut self){self.calls.push("close");}
        fn data(&mut self)->Option<usize>{self.calls.push("data");self.data.then_some(1)}
        fn size(&mut self,_:usize)->usize{self.calls.push("size");self.bytes}
        fn lock(&mut self,_:usize)->Option<*const u16>{self.calls.push("lock");self.lock.then(||self.memory.as_ptr())}
        fn unlock(&mut self,_:usize){self.calls.push("unlock");}
    }
    #[test] fn tiny_unterminated_allocation_is_bounded_and_released(){let mut f=Fake::new(vec![65]);assert_eq!(read_text(&mut f),None);assert_eq!(f.calls,vec!["open","data","size","lock","unlock","close"]);}
    #[test] fn zero_odd_and_oversized_allocations_are_never_locked(){for size in [0,1,3,(MAX_TEXT_UNITS+2)*2]{let mut f=Fake::new(vec![0]);f.bytes=size;assert_eq!(read_text(&mut f),None);assert_eq!(f.calls,vec!["open","data","size","close"]);}}
    #[test] fn final_word_terminator_and_exact_cap_are_valid(){let mut f=Fake::new(vec![65,66,0]);assert_eq!(read_text(&mut f),Some("AB".into()));let mut f=Fake::new(vec![65;MAX_TEXT_UNITS+1]);f.memory[MAX_TEXT_UNITS]=0;assert_eq!(read_text(&mut f).unwrap().len(),MAX_TEXT_UNITS);assert_eq!(&f.calls[f.calls.len()-2..],&["unlock","close"]);}
    #[test] fn malformed_utf16_releases_memory(){let mut f=Fake::new(vec![0xD800,0]);assert_eq!(read_text(&mut f),None);assert_eq!(&f.calls[f.calls.len()-2..],&["unlock","close"]);}
    #[test] fn open_failure_acquires_nothing(){let mut f=Fake::new(vec![0]);f.open=false;assert_eq!(read_text(&mut f),None);assert_eq!(f.calls,vec!["open"]);}
    #[test] fn missing_data_closes_clipboard(){let mut f=Fake::new(vec![0]);f.data=false;assert_eq!(read_text(&mut f),None);assert_eq!(f.calls,vec!["open","data","close"]);}
    #[test] fn lock_failure_closes_without_unlock(){let mut f=Fake::new(vec![0]);f.lock=false;assert_eq!(read_text(&mut f),None);assert_eq!(f.calls,vec!["open","data","size","lock","close"]);}
}