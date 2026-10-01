use unhook_core::Schedule;

#[test]
fn schedules_have_exclusive_endpoints_and_respect_breaks() {
    let schedule = Schedule {
        enabled: true,
        ..Schedule::default()
    };
    schedule.validate().unwrap();
    assert!(!schedule.is_active(0, 539));
    assert!(schedule.is_active(0, 540));
    assert_eq!(schedule.active_until_minute(0, 749), Some(750));
    assert!(!schedule.is_active(0, 750));
    assert!(schedule.is_active(0, 780));
    assert_eq!(schedule.active_until_minute(0, 780), Some(1020));
    assert!(!schedule.is_active(0, 1020));
    assert!(!schedule.is_active(5, 600));
}

#[test]
fn refuses_invalid_times_overnight_windows_and_breaks_outside_window() {
    let mut schedule = Schedule {
        start: "9:00".into(),
        ..Schedule::default()
    };
    assert!(schedule.validate().is_err());
    schedule.start = "17:00".into();
    assert!(schedule.validate().is_err());
    schedule.start = "09:00".into();
    schedule.break_start = "08:00".into();
    assert!(schedule.validate().is_err());
    schedule.break_start = "12:30".into();
    schedule.days = vec![7];
    assert!(schedule.validate().is_err());
}

#[test]
fn validates_weekday_duplicates_and_breaks_strictly_inside_the_window() {
    let mut schedule = Schedule {
        days: vec![0, 0],
        ..Schedule::default()
    };
    assert!(schedule.validate().is_err());
    schedule.days = vec![0];
    schedule.break_start = schedule.start.clone();
    assert!(schedule.validate().is_err());
    schedule.break_start = "12:30".into();
    schedule.break_end = schedule.end.clone();
    assert!(schedule.validate().is_err());
    schedule.break_enabled = false;
    schedule.break_start = "invalid disabled value".into();
    assert!(schedule.validate().is_ok());
}
